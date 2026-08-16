#!/bin/bash

set -e

clone_pkg() {
  # $1=url $2=目标目录 $3=分支(可选) $4=子目录(可选)
  local url dest branch sub tmp tries
  local -a args=()
  url="$1"; dest="$2"; branch="${3:-}"; sub="${4:-}"; tries=0
  [ -n "$branch" ] && args+=(-b "$branch")
  tmp=$(mktemp -d)
  while [ "$tries" -lt 3 ]; do
    rm -rf "$tmp/repo"
    if git clone -q --depth=1 "${args[@]}" "$url" "$tmp/repo"; then
      rm -rf "$dest"
      if [ -n "$sub" ]; then
        cp -a "$tmp/repo/$sub" "$dest"
      else
        cp -a "$tmp/repo" "$dest"
      fi
      rm -rf "$tmp"
      return 0
    fi
    tries=$((tries + 1))
    echo "clone 失败，重试 $tries/3: $url"
    sleep 2
  done
  rm -rf "$tmp"
  echo "clone 失败: $url" >&2
  return 1
}

./scripts/feeds update -a

# 删除会被自定义包遮蔽或依赖缺失的 stock 包
rm -rf feeds/luci/applications/luci-app-passwall
rm -f package/feeds/luci/luci-app-passwall
rm -rf feeds/luci/applications/luci-app-openclash
rm -f package/feeds/luci/luci-app-openclash
rm -rf feeds/packages/net/mosdns
rm -rf feeds/packages/net/v2ray-geodata
rm -rf feeds/packages/net/open-app-filter
rm -rf feeds/luci/themes/luci-theme-argon
rm -rf feeds/luci/themes/luci-theme-netgear
rm -rf feeds/luci/applications/luci-app-mosdns
rm -rf feeds/luci/applications/luci-app-serverchan

grep -q 'PROVIDES:=gnu-wget wget wget-any' feeds/packages/net/wget/Makefile \
  || sed -i 's/PROVIDES:=gnu-wget wget$/PROVIDES:=gnu-wget wget wget-any/' feeds/packages/net/wget/Makefile

# 删除后重建索引，清 defconfig 残留，避免 stock 包被误判为 core 包
./scripts/feeds update -a
rm -rf tmp/info
./scripts/feeds install -a -f

# 源码补丁
sed -i 's/\/bin\/ash/\/usr\/bin\/fish/g' package/base-files/files/etc/passwd
sed -i 's|rw,noatime,discard|rw,noatime|g' package/lean/automount/files/15-automount
sed -i 's|256|1024|g' target/linux/x86/image/Makefile
sed -i 's/Os/O3/g' include/target.mk
grep -q 'nf_conntrack_tcp_max_retrans=5' package/kernel/linux/files/sysctl-nf-conntrack.conf 2>/dev/null \
  || echo 'net.netfilter.nf_conntrack_tcp_max_retrans=5' >> package/kernel/linux/files/sysctl-nf-conntrack.conf
cp -a "$GITHUB_WORKSPACE/scripts/79_move_config" target/linux/x86/base-files/lib/preinit/
# vim-fuller 与 vim-runtime 装同一 runtime 目录会冲突
sed -i 's/ifneq ($(CONFIG_PACKAGE_vim-runtime)$(CONFIG_PACKAGE_vim-help),)/ifneq ($(CONFIG_PACKAGE_vim-runtime)$(CONFIG_PACKAGE_vim-help)$(CONFIG_PACKAGE_vim-fuller),)/' feeds/packages/utils/vim/Makefile

# 第三方包
clone_pkg "https://github.com/tty228/luci-app-wechatpush" "package/luci-app-serverchan" "openwrt-18.06"
clone_pkg "https://github.com/destan19/OpenAppFilter" "package/OpenAppFilter"
clone_pkg "https://github.com/sirpdboy/luci-app-eqosplus" "package/luci-app-eqosplus"
clone_pkg "https://github.com/stackia/rtp2httpd" "package/rtp2httpd" "" "openwrt-support/rtp2httpd"
clone_pkg "https://github.com/stackia/rtp2httpd" "package/luci-app-rtp2httpd" "" "openwrt-support/luci-app-rtp2httpd"
# 仓库无根 Makefile，包在 openwrt-support/ 子目录；用 Makefile.versioned 固定版本
cp -a package/rtp2httpd/Makefile.versioned package/rtp2httpd/Makefile
cp -a package/luci-app-rtp2httpd/Makefile.versioned package/luci-app-rtp2httpd/Makefile
clone_pkg "https://github.com/vernesong/OpenClash" "package/luci-app-openclash" "dev" "luci-app-openclash"
clone_pkg "https://github.com/kiddin9/luci-theme-edge" "package/luci-theme-edge"
clone_pkg "https://github.com/jerrykuku/luci-theme-argon" "package/luci-theme-argon"
clone_pkg "https://github.com/jerrykuku/luci-app-argon-config" "package/luci-app-argon-config"

rm -rf feeds/packages/net/smartdns
clone_pkg "https://github.com/pymumu/luci-app-smartdns" "feeds/luci/applications/luci-app-smartdns" "lede"
clone_pkg "https://github.com/pymumu/openwrt-smartdns" "feeds/packages/net/smartdns"

clone_pkg "https://github.com/sbwml/luci-app-mosdns" "package/luci-app-mosdns" "v5-lua" "luci-app-mosdns"
clone_pkg "https://github.com/sbwml/luci-app-mosdns" "package/mosdns" "v5-lua" "mosdns"
clone_pkg "https://github.com/sbwml/v2ray-geodata" "package/v2ray-geodata"

clone_pkg "https://github.com/linkease/nas-packages-luci" "package/luci-app-ddnsto" "" "luci/luci-app-ddnsto"
clone_pkg "https://github.com/linkease/nas-packages" "package/ddnsto" "" "network/services/ddnsto"

clone_pkg "https://github.com/haiibo/packages" "package/luci-app-onliner" "" "luci-app-onliner"
grep -q 'nlbwmon.@nlbwmon\[0\].refresh_interval=2s' package/lean/default-settings/files/zzz-default-settings \
  || sed -i '$i uci set nlbwmon.@nlbwmon[0].refresh_interval=2s' package/lean/default-settings/files/zzz-default-settings
grep -q 'uci commit nlbwmon' package/lean/default-settings/files/zzz-default-settings \
  || sed -i '$i uci commit nlbwmon' package/lean/default-settings/files/zzz-default-settings
chmod 755 package/luci-app-onliner/root/usr/share/onliner/setnlbw.sh

# x86 只显示 CPU 型号，时间格式，版本号用编译日期
sed -i 's/${g}.*/${a}${b}${c}${d}${e}${f}${hydrid}/g' package/lean/autocore/files/x86/autocore
sed -i 's/os.date()/os.date("%a %Y-%m-%d %H:%M:%S")/g' package/lean/autocore/files/*/index.htm

date_version=$(date +"%y.%m.%d")
orig_version=$(grep 'DISTRIB_REVISION=' package/lean/default-settings/files/zzz-default-settings | awk -F "'" '{print $2}')
sed -i "s/${orig_version}/R${date_version} by Hex/g" package/lean/default-settings/files/zzz-default-settings

# 第三方包 Makefile 的相对路径与 GHREPO 宏统一改写成绝对路径/真实 URL
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/..\/..\/luci.mk/$(TOPDIR)\/feeds\/luci\/luci.mk/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/..\/..\/lang\/golang\/golang-package.mk/$(TOPDIR)\/feeds\/packages\/lang\/golang\/golang-package.mk/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/PKG_SOURCE_URL:=@GHREPO/PKG_SOURCE_URL:=https:\/\/github.com/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/PKG_SOURCE_URL:=@GHCODELOAD/PKG_SOURCE_URL:=https:\/\/codeload.github.com/g' {}

# 不让主题包默认接管 mediaurlbase，默认主题由 init-settings 统一设置
find package/luci-theme-*/* -type f -name '*luci-theme-*' -print -exec sed -i '/set luci.main.mediaurlbase/d' {} \;

# smartdns bindgen --force 每次重装全部 crates，去掉后走缓存 + 重试
if grep -qF -- '--force --locked bindgen-cli' feeds/packages/net/smartdns/Makefile; then
  sed -i 's/--force --locked bindgen-cli/--locked bindgen-cli || cargo install --locked bindgen-cli/' feeds/packages/net/smartdns/Makefile
  grep -qF -- 'cargo install --locked bindgen-cli || cargo install --locked bindgen-cli' feeds/packages/net/smartdns/Makefile \
    || echo "smartdns bindgen 补丁校验失败"
else
  echo "smartdns 已无 --force bindgen，跳过补丁"
fi

# 第二阶段：注入的 feeds 包入索引并 install
./scripts/feeds update -a
./scripts/feeds install -a -f

# ccache 前缀含空格会打断编译，icu 改用 NOCACHE 变体
sed -i 's/TARGET_CC/TARGET_CC_NOCACHE/g' feeds/packages/libs/icu/Makefile
sed -i 's/TARGET_CXX/TARGET_CXX_NOCACHE/g' feeds/packages/libs/icu/Makefile

cp "$GITHUB_WORKSPACE/$CONFIG_FILE" .config
make defconfig
