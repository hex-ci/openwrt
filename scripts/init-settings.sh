#!/bin/bash

# Set default theme to luci-theme-rosy
uci set luci.main.mediaurlbase='/luci-static/rosy'
uci commit luci

# Disable IPV6 ula prefix
# sed -i 's/^[^#].*option ula/#&/' /etc/config/network

# Check file system during boot
# uci set fstab.@global[0].check_fs=1
# uci commit fstab

exit 0
