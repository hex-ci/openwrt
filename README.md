# OpenWrt 固件

[![build](https://github.com/hex-ci/openwrt/actions/workflows/build.yml/badge.svg)](https://github.com/hex-ci/openwrt/actions/workflows/build.yml) [![](https://img.shields.io/badge/编译-配置-orange.svg?logo=apache-spark)](https://github.com/hex-ci/openwrt/blob/main/configs/x86_64.config) [![](https://img.shields.io/badge/下载-链接-blueviolet.svg?logo=hack-the-box)](https://github.com/hex-ci/openwrt/releases/tag/X86_64)

基于 Lean 源码编译的自用 OpenWrt 固件。

## 默认信息

- 默认地址 `192.168.1.1`，账号 `root`，密码 `password`
- 默认主题 Argon，默认 shell fish
- 目标 x86_64 / musl / `-O3`

## 主要插件

OpenClash（smart 内核）、AdGuardHome、MosDNS、SmartDNS、rtp2httpd、DDNSTO、FRP、ZeroTier、WireGuard、SoftEther、OpenAppFilter、Samba4、Aria2、Transmission、SQM 等，主题 Argon + Edge。

## 工作流

| 文件 | 触发 | 说明 |
|---|---|---|
| `build.yml` | 定时（每日）+ 手动 | 托管 runner 编译并发布 `X86_64` |
| `X86_64-self.yml` | 手动 | 自托管 runner 编译并发布 `X86_64-self` |
| `smoke-test.yml` | 手动 | 用 QEMU 冒烟测试最新发布镜像 |

## 自定义

- 包配置 `configs/x86_64.config`
- 源码补丁与第三方包注入 `diy-script.sh`
- OpenClash 内核 `scripts/preset-clash-core.sh`
- 首次启动配置 `scripts/init-settings.sh`
