#!/bin/bash

set -e

mkdir -p files/etc/openclash/core

CORE_VER_URL="https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version"
CLASH_SMART_URL="https://raw.githubusercontent.com/vernesong/OpenClash/core/master/smart/clash-linux-amd64.tar.gz"
GEOIP_URL="https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat"
GEOSITE_URL="https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat"

smart_ver=""
for i in 1 2 3; do
  smart_ver=$(wget -qO- --timeout=20 "$CORE_VER_URL" 2>/dev/null | sed -n '2p' | tr -d '\r\n')
  [ -n "$smart_ver" ] && break
  echo "获取 smart 内核版本失败，重试 $i/3"
  sleep 2
done

# 每次无条件下载 + 原子替换，避免旧内核残留
if wget -qO- --timeout=90 "$CLASH_SMART_URL" | tar xOvz > files/etc/openclash/core/clash_meta.new; then
  mv files/etc/openclash/core/clash_meta.new files/etc/openclash/core/clash_meta
  chmod +x files/etc/openclash/core/clash_meta
  echo "smart 内核已更新: ${smart_ver:-未知版本}"
else
  rm -f files/etc/openclash/core/clash_meta.new
  echo "smart 内核下载失败" >&2
  exit 1
fi

wget -qO- --timeout=90 "$GEOIP_URL" > files/etc/openclash/GeoIP.dat.tmp \
  && mv files/etc/openclash/GeoIP.dat.tmp files/etc/openclash/GeoIP.dat
wget -qO- --timeout=90 "$GEOSITE_URL" > files/etc/openclash/GeoSite.dat.tmp \
  && mv files/etc/openclash/GeoSite.dat.tmp files/etc/openclash/GeoSite.dat
