#!/bin/bash

CURRENT_PATH=$(pwd)

clone_or_update_git_repo() {
  # 参数检查
  if [ "$#" -lt 2 ]; then
    echo "Usage: clone_or_update_git_repo <git_url> <target_directory> [branch] [subdirectory]"
    return 1
  fi

  local git_url="$1"
  local source_target_directory="$2"
  local target_directory="$2"
  local branch="$3"
  local subdirectory="$4"

  if [ -n "$subdirectory" ]; then
    target_directory=$CURRENT_PATH/repos/$(echo "$git_url" | awk -F'/' '{print $(NF-1)"-"$NF}')
  fi

  # 检查目标目录是否存在
  if [ -d "$target_directory" ]; then
    pushd "$target_directory" || return 1
    git pull
    popd
  else
    if [ -n "$branch" ]; then
      git clone --depth=1 -b "$branch" "$git_url" "$target_directory"
    else
      git clone --depth=1 "$git_url" "$target_directory"
    fi
  fi

  if [ -n "$subdirectory" ]; then
    cp -a $target_directory/$subdirectory $source_target_directory
  fi
}

# 修改默认IP
# sed -i 's/192.168.1.1/10.0.0.1/g' package/base-files/files/bin/config_generate

# 更改默认 Shell 为 fish
sed -i 's/\/bin\/ash/\/usr\/bin\/fish/g' package/base-files/files/etc/passwd

# 更改默认 Theme
# sed -i 's/+luci-theme-bootstrap/+luci-theme-rosy/g' feeds/luci/collections/luci/Makefile

# TTYD 自动登录
# sed -i 's|/bin/login|/bin/login -f root|g' feeds/packages/utils/ttyd/files/ttyd.config

sed -i 's|rw,noatime,discard|rw,noatime|g' package/lean/automount/files/15-automount
sed -i 's|256|1024|g' target/linux/x86/image/Makefile

# 使用 O3 级别的优化
sed -i 's/Os/O3/g' include/target.mk

echo "net.netfilter.nf_conntrack_tcp_max_retrans=5" >> package/kernel/linux/files/sysctl-nf-conntrack.conf

# 移除要替换的包
rm -rf feeds/packages/net/mosdns
rm -rf feeds/packages/net/v2ray-geodata
rm -rf feeds/packages/net/msd_lite
rm -rf feeds/packages/net/smartdns
rm -rf feeds/luci/themes/luci-theme-argon
rm -rf feeds/luci/themes/luci-theme-netgear
rm -rf feeds/luci/applications/luci-app-mosdns
rm -rf feeds/luci/applications/luci-app-netdata
rm -rf feeds/luci/applications/luci-app-serverchan

# 添加额外插件
git clone --depth=1 https://github.com/kongfl888/luci-app-adguardhome package/luci-app-adguardhome
git clone --depth=1 -b openwrt-18.06 https://github.com/tty228/luci-app-wechatpush package/luci-app-serverchan
git clone --depth=1 https://github.com/ilxp/luci-app-ikoolproxy package/luci-app-ikoolproxy
git clone --depth=1 https://github.com/esirplayground/luci-app-poweroff package/luci-app-poweroff main
git clone --depth=1 https://github.com/destan19/OpenAppFilter package/OpenAppFilter
git clone --depth=1 https://github.com/Jason6111/luci-app-netdata package/luci-app-netdata
clone_or_update_git_repo https://github.com/Lienol/openwrt-package package/luci-app-filebrowser "" luci-app-filebrowser
clone_or_update_git_repo https://github.com/immortalwrt/luci package/luci-app-eqos "openwrt-18.06" applications/luci-app-eqos
clone_or_update_git_repo https://github.com/openwrt/packages package/telnet-bsd "" net/telnet-bsd

# 科学上网插件
git clone --depth=1 https://github.com/jerrykuku/lua-maxminddb package/lua-maxminddb
clone_or_update_git_repo https://github.com/vernesong/OpenClash package/luci-app-openclash "dev" luci-app-openclash

# Themes
git clone --depth=1 -b 18.06 https://github.com/kiddin9/luci-theme-edge package/luci-theme-edge
git clone --depth=1 -b 18.06 https://github.com/jerrykuku/luci-theme-argon package/luci-theme-argon
git clone --depth=1 https://github.com/jerrykuku/luci-app-argon-config package/luci-app-argon-config
git clone --depth=1 https://github.com/xiaoqingfengATGH/luci-theme-infinityfreedom package/luci-theme-infinityfreedom
clone_or_update_git_repo https://github.com/haiibo/packages package/luci-theme-atmaterial "" luci-theme-atmaterial
clone_or_update_git_repo https://github.com/haiibo/packages package/luci-theme-opentomcat "" luci-theme-opentomcat
clone_or_update_git_repo https://github.com/haiibo/packages package/luci-theme-netgear "" luci-theme-netgear
clone_or_update_git_repo https://github.com/hex-ci/luci-theme-rosy package/luci-theme-rosy "" luci-theme-rosy

# 更改 Argon 主题背景
# cp -f $GITHUB_WORKSPACE/images/bg1.jpg package/luci-theme-argon/htdocs/luci-static/argon/img/bg1.jpg

# SmartDNS
git clone --depth=1 -b lede https://github.com/pymumu/luci-app-smartdns feeds/luci/applications/luci-app-smartdns
git clone --depth=1 https://github.com/pymumu/openwrt-smartdns feeds/packages/net/smartdns

# msd_lite
git clone --depth=1 https://github.com/ximiTech/luci-app-msd_lite package/luci-app-msd_lite
git clone --depth=1 https://github.com/ximiTech/msd_lite package/msd_lite

# MosDNS
clone_or_update_git_repo https://github.com/sbwml/luci-app-mosdns package/luci-app-mosdns "v5-lua" luci-app-mosdns
clone_or_update_git_repo https://github.com/sbwml/luci-app-mosdns package/mosdns "v5-lua" mosdns
clone_or_update_git_repo https://github.com/sbwml/v2ray-geodata package/v2ray-geodata

# DDNS.to
clone_or_update_git_repo https://github.com/linkease/nas-packages-luci package/luci-app-ddnsto "" luci/luci-app-ddnsto
clone_or_update_git_repo https://github.com/linkease/nas-packages package/ddnsto "" network/services/ddnsto

# Alist
clone_or_update_git_repo https://github.com/sbwml/luci-app-alist package/luci-app-alist "lua" luci-app-alist
clone_or_update_git_repo https://github.com/sbwml/luci-app-alist package/alist "lua" alist

# iStore
clone_or_update_git_repo https://github.com/linkease/istore-ui package/app-store-ui "" app-store-ui
clone_or_update_git_repo https://github.com/linkease/istore package/luci-app-store "" luci

# 在线用户
clone_or_update_git_repo https://github.com/haiibo/packages package/luci-app-onliner "" luci-app-onliner
sed -i '$i uci set nlbwmon.@nlbwmon[0].refresh_interval=2s' package/lean/default-settings/files/zzz-default-settings
sed -i '$i uci commit nlbwmon' package/lean/default-settings/files/zzz-default-settings
chmod 755 package/luci-app-onliner/root/usr/share/onliner/setnlbw.sh

# x86 型号只显示 CPU 型号
sed -i 's/${g}.*/${a}${b}${c}${d}${e}${f}${hydrid}/g' package/lean/autocore/files/x86/autocore

# 修改本地时间格式
sed -i 's/os.date()/os.date("%a %Y-%m-%d %H:%M:%S")/g' package/lean/autocore/files/*/index.htm

# 修改版本为编译日期
date_version=$(date +"%y.%m.%d")
orig_version=$(cat "package/lean/default-settings/files/zzz-default-settings" | grep DISTRIB_REVISION= | awk -F "'" '{print $2}')
sed -i "s/${orig_version}/R${date_version} by Hex/g" package/lean/default-settings/files/zzz-default-settings

# 修复 hostapd 报错
# cp -f $GITHUB_WORKSPACE/scripts/011-fix-mbo-modules-build.patch package/network/services/hostapd/patches/011-fix-mbo-modules-build.patch

# 修改 Makefile
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/..\/..\/luci.mk/$(TOPDIR)\/feeds\/luci\/luci.mk/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/..\/..\/lang\/golang\/golang-package.mk/$(TOPDIR)\/feeds\/packages\/lang\/golang\/golang-package.mk/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/PKG_SOURCE_URL:=@GHREPO/PKG_SOURCE_URL:=https:\/\/github.com/g' {}
find package/*/ -maxdepth 2 -path "*/Makefile" | xargs -i sed -i 's/PKG_SOURCE_URL:=@GHCODELOAD/PKG_SOURCE_URL:=https:\/\/codeload.github.com/g' {}

# 取消主题默认设置
find package/luci-theme-*/* -type f -name '*luci-theme-*' -print -exec sed -i '/set luci.main.mediaurlbase/d' {} \;

# 调整 V2ray服务器 到 VPN 菜单
# sed -i 's/services/vpn/g' feeds/luci/applications/luci-app-v2ray-server/luasrc/controller/*.lua
# sed -i 's/services/vpn/g' feeds/luci/applications/luci-app-v2ray-server/luasrc/model/cbi/v2ray_server/*.lua
# sed -i 's/services/vpn/g' feeds/luci/applications/luci-app-v2ray-server/luasrc/view/v2ray_server/*.htm

cp -a $GITHUB_WORKSPACE/scripts/79_move_config target/linux/x86/base-files/lib/preinit/

./scripts/feeds update -a
./scripts/feeds install -a
