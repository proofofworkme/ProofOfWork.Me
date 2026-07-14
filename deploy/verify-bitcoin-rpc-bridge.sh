#!/bin/sh
set -eu

network_name="mempool_mempool"
expected_gateway="172.27.0.1"
expected_cidr="172.27.0.1/16"
attempt=0
max_attempts=30

while [ "$attempt" -lt "$max_attempts" ]; do
  gateway="$(
    /usr/bin/docker network inspect \
      --format '{{(index .IPAM.Config 0).Gateway}}' \
      "$network_name" 2>/dev/null || true
  )"
  if [ "$gateway" = "$expected_gateway" ] && \
    /usr/sbin/ip -o -4 address show | /usr/bin/grep -Fq "inet $expected_cidr"; then
    exit 0
  fi
  attempt=$((attempt + 1))
  /usr/bin/sleep 2
done

echo "Required Docker RPC bridge $network_name at $expected_cidr is unavailable." >&2
exit 1
