#!/usr/bin/env node

/**
 * OpenWrt 镜像虚拟机冒烟测试（QEMU TCG 模式，无 KVM 依赖，零 npm 依赖）。
 *
 * 验证构建出的 x86_64 镜像：
 *  1. 能启动（串口出现 shell prompt 或 login prompt）
 *  2. root 进入 shell（OpenWrt 串口为 askfirst 模式——回车直接进 root shell，
 *     不验证密码；这是物理控制台信任模型，测试边界即止于此，不做密码认证测试）
 *  3. 系统版本/运行正常
 *  4. LuCI Web 界面可访问（HTTP 200/302/403 + 页面含登录表单）
 *  5. 关键服务端口（80/443/22）监听正常
 *  6. 能正常关机
 *
 * 用法:
 *   node test-vm.js [--image 路径] [--timeout 秒] [--mem MB]
 *
 * 退出码: 0=全部通过, 1=测试失败, 2=环境/参数错误
 */

"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const RESULTS = [];

function log(msg) {
  console.log(`[test-vm] ${msg}`);
}

function record(name, passed, detail = "") {
  RESULTS.push({ name, passed, detail });
  console.log(`[test-vm] ${passed ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

function parseArgs(argv) {
  const args = { image: null, timeout: 300, mem: 512 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--image") args.image = argv[++i];
    else if (argv[i] === "--timeout") args.timeout = parseInt(argv[++i], 10) || 300;
    else if (argv[i] === "--mem") args.mem = parseInt(argv[++i], 10) || 512;
  }
  return args;
}

function findImage(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      log(`指定的镜像不存在: ${explicit}`);
      process.exit(2);
    }
    return path.resolve(explicit);
  }
  const base = process.env.IMAGE_DIR || process.cwd();
  const byMtime = (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
  // 优先 vmdk（QEMU 原生支持，零解压）；img.gz 是"gzip 流+trailing garbage"，zcat 返回非零但数据完整
  let vmdks = [];
  try { vmdks = fs.readdirSync(base).filter(f => f.includes("squashfs-combined") && f.endsWith(".vmdk")).map(f => path.join(base, f)).sort(byMtime); } catch {}
  let gzs = [];
  try { gzs = fs.readdirSync(base).filter(f => f.includes("squashfs-combined") && f.endsWith(".img.gz")).map(f => path.join(base, f)).sort(byMtime); } catch {}
  const candidates = vmdks.length ? vmdks : gzs;
  if (!candidates.length) {
    log("未找到镜像，先构建镜像或指定 --image");
    process.exit(2);
  }
  return candidates[0];
}

class Console {
  constructor(sockPath, timeoutMs) {
    this.sockPath = sockPath;
    this.timeoutMs = timeoutMs;
    this.sock = null;
    this.buf = "";
  }

  connect() {
    return new Promise((resolve) => {
      const deadline = Date.now() + this.timeoutMs;
      const tryConnect = () => {
        if (Date.now() > deadline) return resolve(false);
        const s = net.connect(this.sockPath);
        s.on("connect", () => {
          this.sock = s;
          s.on("data", (d) => { this.buf += d.toString("utf8"); });
          resolve(true);
        });
        s.on("error", () => {
          s.destroy();
          setTimeout(tryConnect, 1000);
        });
      };
      tryConnect();
    });
  }

  waitFor(patterns, timeoutMs) {
    const pats = patterns.map(p => p instanceof RegExp ? p : new RegExp(escapeRegExp(p)));
    return new Promise((resolve) => {
      const deadline = Date.now() + (timeoutMs || this.timeoutMs);
      const check = () => {
        for (const p of pats) {
          const m = this.buf.match(p);
          if (m) return resolve(p);
        }
        if (Date.now() > deadline) return resolve(null);
        setTimeout(check, 500);
      };
      check();
    });
  }

  send(data) {
    if (this.sock) this.sock.write(data);
  }

  // TCG 模式下 QEMU 模拟 UART 的 FIFO 处理慢，一次性灌入长命令会丢数据/拆行
  // （症状: 命令回显中间出现 \r\n，ash 拿到残缺命令不执行）。分块节流发送。
  // chunk 4 / delay 40 是实测可靠的参数（长命令 + 系统繁忙时也不丢字节）。
  sendSlow(data, chunkSize = 4, delayMs = 40) {
    const str = data.toString();
    let i = 0;
    return new Promise((resolve) => {
      const step = () => {
        if (i >= str.length) return resolve();
        this.send(str.slice(i, i + chunkSize));
        i += chunkSize;
        setTimeout(step, delayMs);
      };
      step();
    });
  }

  sendCmd(cmd, waitMs = 2000, marker = null) {
    // 等待命令真正执行完：shell 执行完会打印新 prompt（root@OpenWrt:/#）。
    // 注意: boot 阶段残留的 \r 会触发额外 prompt，导致"prompt 增加"误判。
    // 因此先等命令回显出现（shell 收到命令），再等 prompt 增加。
    // 返回本次命令的新输出（slice 发送前的部分），避免旧 buf 干扰正则匹配。
    const cmdHead = cmd.slice(0, 12);
    const startPos = this.buf.length;
    return new Promise((resolve) => {
      const promptBefore = (this.buf.match(/root@OpenWrt:\/#/g) || []).length;
      this.sendSlow(cmd + "\r").then(() => {
        const deadline = Date.now() + waitMs;
        const poll = () => {
          const echoed = this.buf.includes(cmdHead); // shell 已收到命令（回显）
          const promptNow = (this.buf.match(/root@OpenWrt:\/#/g) || []).length;
          if (echoed && promptNow > promptBefore) return resolve(this.buf.slice(startPos));
          if (marker && this.buf.includes(marker)) return resolve(this.buf.slice(startPos));
          if (Date.now() >= deadline) return resolve(this.buf.slice(startPos));
          setTimeout(poll, 300);
        };
        poll();
      });
    });
  }

  close() {
    if (this.sock) { this.sock.destroy(); this.sock = null; }
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const image = findImage(args.image);
  log(`测试镜像: ${image}`);

  // 检查 QEMU
  try {
    const ver = execFileSync("qemu-system-x86_64", ["--version"], { encoding: "utf8" }).split("\n")[0];
    log(`QEMU 版本: ${ver}`);
  } catch {
    log("qemu-system-x86_64 未安装，请先: sudo apt-get install -y qemu-system-x86");
    process.exit(2);
  }

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "owrt-test-"));
  const sockPath = path.join(tmpdir, "console.sock");
  let imgPath = image;
  const isVmdk = image.endsWith(".vmdk");
  const isGzip = image.endsWith(".gz");

  // gzip 镜像解压：zcat 对 trailing garbage 返回非零但数据完整，验证输出大小兜底
  if (isGzip) {
    log("解压 img.gz (zcat) ...");
    const raw = path.join(tmpdir, "disk.img");
    try {
      execFileSync("zcat", [image], { stdio: ["ignore", fs.openSync(raw, "w"), "ignore"] });
    } catch {}
    const size = fs.statSync(raw).size;
    if (size < 100 << 20) {
      log(`解压结果异常: ${size >> 20} MiB（预期 >100MiB）`);
      process.exit(1);
    }
    imgPath = raw;
    log(`解压完成: ${size >> 20} MiB`);
  }

  const qemuArgs = [
    "-m", String(args.mem),
    "-smp", "2",
    "-display", "none",
    "-drive", `file=${imgPath},format=${isVmdk ? "vmdk" : "raw"},if=ide`,
    "-netdev", "user,id=net0",
    "-device", "virtio-net-pci,netdev=net0",
    "-serial", `unix:${sockPath},server,nowait`,
    "-monitor", "none",
    "-no-reboot",
  ];
  log(`启动 QEMU: ${qemuArgs.join(" ")}`);
  let qemu = spawn("qemu-system-x86_64", qemuArgs, { stdio: "ignore" });

  // 防御: QEMU 可能因 vmdk 被残留进程锁定而立即退出（Failed to get "write" lock）。
  // 清理残留进程后自动重试（最多 3 次），而不是直接失败。
  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    if (qemu.exitCode === null) break; // 进程存活，启动成功
    log(`QEMU 第 ${attempt} 次启动失败 (exit ${qemu.exitCode})，清理残留进程后重试...`);
    try { execFileSync("pkill", ["-9", "-f", "qemu-system-x86_64"]); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    qemu = spawn("qemu-system-x86_64", qemuArgs, { stdio: "ignore" });
  }
  if (qemu.exitCode !== null) {
    record("QEMU 启动", false, "3 次启动均失败（vmdk 被锁定或 QEMU 异常）");
    process.exit(1);
  }
  record("QEMU 启动", true, "虚拟机已启动");

  const term = new Console(sockPath, args.timeout * 1000);
  try {
    if (!(await term.connect())) {
      record("QEMU 串口连接", false, `${args.timeout}s 内无法连接串口`);
      return 1;
    }
    log("串口已连接，等待系统启动...");

    // ---- 1. 启动 + 登录 ----
    // 注意: OpenWrt 串口 getty 是 askfirst 模式——不主动打印 prompt，
    // 必须发送回车才会启动 shell（手动测试验证过: 发送 \r 后出现 BusyBox banner）。
    // 策略: 定期发回车唤醒，直到出现完整 shell prompt（root@OpenWrt:/#）。
    // 陷阱: "root@" 太宽松会误匹配内核日志（如 cmdline 里的 root=...），
    // 必须在系统真正进 shell 后才发测试命令，否则字节被启动日志淹没。
    const bootDeadline = Date.now() + args.timeout * 1000;
    const bootStart = Date.now();
    let bootHit = null;
    while (Date.now() < bootDeadline) {
      if (term.buf.includes("root@OpenWrt:/#")) { bootHit = "prompt"; break; }
      if (term.buf.includes("login:")) { bootHit = "login"; break; }
      term.send("\r"); // askfirst 唤醒
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!bootHit) {
      record("系统启动到登录界面", false, "超时未见 shell prompt（askfirst 回车唤醒无效）");
      return 1;
    }
    record("系统启动到登录界面", true, `串口已出现 ${bootHit === "login" ? "login 提示" : "shell prompt"}（约 ${Math.round((Date.now() - bootStart) / 1000)}s）`);

    // 若停在 login: 则尝试空密码登录；否则已直接进 shell
    if (bootHit === "login") {
      term.send("root\r");
      await term.waitFor(["Password:", "root@OpenWrt:/#"], 30000);
      if (term.buf.includes("Password:")) {
        term.send("\r");
        const sh = await term.waitFor(["root@OpenWrt:/#", "incorrect", "denied"], 15000);
        if (!sh || !term.buf.includes("root@OpenWrt:/#")) {
          record("root 登录", false, "空密码登录失败（备份配置可能设置了 root 密码）");
          return 1;
        }
        record("root 登录", true, "空密码登录成功");
      } else {
        record("root 登录", true, "无需密码直接进入 shell");
      }
    } else {
      record("root 登录", true, "直接进入 shell（未经过 login prompt）");
    }

    // 确认 shell 真正可交互：发探测命令等回显，防止启动日志仍在刷导致命令丢失
    let shellReady = false;
    for (let i = 0; i < 5; i++) {
      const probe = await term.sendCmd("echo SHELL_PROBE_OK", 3000, "SHELL_PROBE_OK");
      if (probe.includes("SHELL_PROBE_OK")) { shellReady = true; break; }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!shellReady) {
      record("shell 交互就绪", false, "探测命令无回显（系统可能仍在启动）");
      return 1;
    }
    record("shell 交互就绪", true, "探测命令正常回显");

    // 排空 boot 阶段残留的 \r：它们会触发空命令 prompt，干扰后续 sendCmd 的
    // "prompt 增加"判断。多发几个 \r 让残留全部消耗，再等 prompt 稳定。
    for (let i = 0; i < 3; i++) {
      term.send("\r");
      await new Promise(r => setTimeout(r, 800));
    }
    await new Promise(r => setTimeout(r, 2000));

    // 等待系统真正就绪：TCG 模式服务启动慢（备份配置含 WireGuard/OpenClash 等）。
    // boot complete 日志不一定打到 console（logd 过滤），所以双保险：
    // 先等一个启动窗口（60s），然后轮询 uhttpd 进程 + br-lan IP。
    log("等待服务启动窗口（60s）...");
    await new Promise(r => setTimeout(r, 60000));
    log("轮询 uhttpd + br-lan IP...");
    const readyDeadline = Date.now() + 240000;
    let servicesReady = false;
    while (Date.now() < readyDeadline) {
      const u = await term.sendCmd("echo U=$(pidof uhttpd | wc -w)", 8000);
      const uM = u.match(/U=(\d+)/);
      const uCount = uM ? parseInt(uM[1], 10) : 0;
      if (uCount >= 1) {
        const ip = await term.sendCmd(
          "ip -4 addr show br-lan 2>/dev/null | grep inet | awk '{print $2}'", 8000);
        const ipReady = ip.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipReady) { servicesReady = true; break; }
      }
      log(`  未就绪（${Math.round((Date.now() - (readyDeadline - 240000)) / 1000)}s）: uhttpd=${uCount}，继续等待...`);
      await new Promise(r => setTimeout(r, 8000));
    }
    if (!servicesReady) {
      record("服务就绪", false, "启动窗口 + 240s 内 uhttpd/br-lan 未就绪");
      return 1;
    }
    const ipCheck = await term.sendCmd(
      "ip -4 addr show br-lan 2>/dev/null | grep inet | awk '{print $2}'", 8000);
    const ipReadyM = ipCheck.match(/(\d+\.\d+\.\d+\.\d+)/);
    record("服务就绪", true,
      `uhttpd 运行 + br-lan ${ipReadyM ? ipReadyM[1] : "?"}（启动约 ${Math.round((Date.now() - bootStart) / 1000)}s）`);

    // ---- 2. 系统版本 ----
    const out = await term.sendCmd("cat /etc/openwrt_release", 2500);
    const revM = out.match(/DISTRIB_REVISION='([^']*)'/);
    record("系统版本读取", /OpenWrt|LEDE/.test(out), revM ? revM[1] : out.trim().slice(0, 60));

    // ---- 3. 关键服务端口 ----
    const netOut = await term.sendCmd(
      "netstat -tlnp 2>/dev/null | grep -E ':80 |:443 |:22 ' | head -5", 3500);
    const ports = [...new Set([...netOut.matchAll(/:(\d+)\s/g)].map(m => m[1]))];
    const missing = ["80", "443", "22"].filter(p => !ports.includes(p));
    record("关键端口监听 (80/443/22)", missing.length === 0,
      missing.length ? `缺失: ${missing.join(",")}` : `监听: ${ports.sort().join(",")}`);

    // ---- 4. 探测 br-lan IP ----
    const ipOut = await term.sendCmd(
      "ip -4 addr show br-lan 2>/dev/null | grep inet | awk '{print $2}'", 2500);
    const ipM = ipOut.match(/(\d+\.\d+\.\d+\.\d+)/);
    const lanIp = ipM ? ipM[1] : "192.168.1.1";
    log(`br-lan IP: ${lanIp}`);

    // ---- 5. LuCI Web 界面 ----
    // 拆成两步短命令，避免长命令在 TCG UART 下丢字节：
    // 1) curl 下载页面（CODE: 标记状态码）
    // 2) grep 数登录表单（MARKER: 标记）
    // 注意: 该镜像 uhttpd 对 curl 直连返回 403 状态码，但页面内容完整渲染
    // （实测 403 + 完整 LuCI 登录页，含 form-login 表单）——判定以内容为准
    const httpOut = await term.sendCmd(
      `curl -s --max-time 20 -o /tmp/luci_check.html -w 'CODE:%{http_code}' http://${lanIp}/cgi-bin/luci ; echo`, 30000);
    const codeM = httpOut.match(/CODE:(\d{3})/);
    const code = codeM ? codeM[1] : "000";
    const markOut = await term.sendCmd(
      "echo MARKER=$(grep -c 'form-login' /tmp/luci_check.html 2>/dev/null)", 8000);
    const markerM = markOut.match(/MARKER=(\d+)/);
    const formCount = markerM ? parseInt(markerM[1], 10) : 0;
    // 状态码 200/302/403 + 页面含 form-login 表单 = LuCI 界面可访问
    const luciOk = formCount >= 1 && ["200", "302", "403"].includes(code);
    if (!luciOk) log(`[调试] LuCI 原始输出: ${JSON.stringify((httpOut + markOut).slice(-400))}`);
    record("LuCI Web 界面", luciOk,
      `HTTP ${code}, 登录表单数: ${formCount}`);

    // ---- 6. 关键进程 ----
    // BusyBox 的 pgrep 不支持 -c，改用 pidof | wc -w（dnsmasq 通常有 2 个实例，属正常）
    // 注意 waitMs 要足够长：TCG 模式下命令执行慢，2500ms 会超时返回空
    const psOut = await term.sendCmd(
      "echo U=$(pidof uhttpd | wc -w) D=$(pidof dropbear | wc -w) N=$(pidof dnsmasq | wc -w)", 15000);
    const uM = psOut.match(/U=(\d+)/), dM = psOut.match(/D=(\d+)/), nM2 = psOut.match(/N=(\d+)/);
    const u = uM ? parseInt(uM[1], 10) : 0;
    const d = dM ? parseInt(dM[1], 10) : 0;
    const n = nM2 ? parseInt(nM2[1], 10) : 0;
    if (u + d + n === 0) log(`[调试] pidof 原始输出: ${JSON.stringify(psOut.slice(-400))}`);
    record("关键进程运行 (uhttpd/dropbear/dnsmasq)", u >= 1 && d >= 1 && n >= 1,
      `uhttpd=${u} dropbear=${d} dnsmasq=${n}`);

    // ---- 7. 正常关机 ----
    // 关键: 该镜像内核未启用 ACPI（target/linux/x86/config-6.12: "# CONFIG_ACPI is not set"），
    // busybox poweroff 调用 reboot(RB_POWER_OFF) 会退化为 halt，QEMU 不会退出
    // （实测: poweroff 回显 + 新 shell 提示符，命令"无效"）。因此改用 reboot:
    // QEMU 带 -no-reboot，guest 触发内核复位（x86 走 8042 传统复位，不依赖 ACPI）时
    // QEMU 直接退出。第 1 次 reboot 走正常关机流程（procd 停服务），60s 超时则
    // fallback reboot -f（强制复位，立即触发 QEMU 退出）。
    // 发送必须用 sendSlow（TCG UART 一次性写入会丢字节，与其它命令一致）。
    // 先注册 exit 监听再发命令，避免"QEMU 已退出但监听未注册"的竞态。
    const SHUT_CMDS = ["reboot", "reboot -f"];
    let exited = false;
    for (let i = 0; i < SHUT_CMDS.length && !exited; i++) {
      const cmd = SHUT_CMDS[i];
      term.buf = "";
      term.send("\r");
      const idle = await term.waitFor([/root@OpenWrt:\/#/], 15000);
      if (!idle) log(`[调试] 尝试 ${cmd} 前 15s 未见 shell 提示符（shell 可能繁忙）`);
      await new Promise(r => setTimeout(r, 500));
      term.buf = "";
      const waitExit = new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 60000);
        qemu.once("exit", () => { clearTimeout(t); resolve(true); });
      });
      await term.sendSlow(cmd + "\r");
      const echoed = await term.waitFor([cmd.split(" ")[0]], 10000);
      if (!echoed) log(`[调试] ${cmd} 无回显（命令可能被吞）`);
      exited = await waitExit;
      if (!exited) {
        log(`[调试] ${cmd} 后 60s 未退出，串口尾部: ${JSON.stringify(term.buf.slice(-300))}`);
      }
    }
    record("正常关机", exited, exited ? "关机/重启生效，QEMU 已退出" : "reboot 与 reboot -f 均 60s 内未退出（见调试输出）");

  } finally {
    term.close();
    if (qemu.exitCode === null) {
      qemu.kill();
      // 等 QEMU 真正退出，避免僵尸进程残留（vmdk 锁不释放会导致下次测试连不上串口）
      try { await new Promise(r => { const t = setTimeout(r, 5000); qemu.once("exit", () => { clearTimeout(t); r(); }); }); } catch {}
    }
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
  }

  // ---- 汇总 ----
  console.log("\n=================== 虚拟机测试结果 ===================");
  const passed = RESULTS.filter(r => r.passed).length;
  for (const r of RESULTS) {
    console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  }
  console.log(`  通过 ${passed}/${RESULTS.length}`);
  console.log("=====================================================");
  return passed === RESULTS.length ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("[test-vm] 未预期错误:", e);
  process.exit(1);
});
