import { expect, test } from "vitest";
import { isNonPublicIp, assertPublicFeedUrl } from "@/lib/ics/import.server";
test("blocks non-public", () => {
  for (const ip of ["127.0.0.1","10.1.2.3","169.254.169.254","172.16.0.1","192.168.1.1","100.64.0.1","0.0.0.0","224.0.0.1","::1","::","fe80::1","fc00::1","fd12::1","ff02::1","::ffff:127.0.0.1","::ffff:7f00:1","2001:db8::1","64:ff9b::a00:1","2002:a00:1::"]) expect(isNonPublicIp(ip), ip).toBe(true);
});
test("allows public", () => {
  for (const ip of ["17.253.144.10","8.8.8.8","2606:4700::1111","2a00:1450:4001::200e"]) expect(isNonPublicIp(ip), ip).toBe(false);
});
test("rejects http", () => { expect(() => assertPublicFeedUrl(new URL("http://p01-calendars.icloud.com/x"))).toThrow(); });
