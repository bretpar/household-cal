import { afterEach, expect, test, vi } from "vitest";
import { isNonPublicIp, readDnsAnswers, assertPublicFeedUrl, assertResolvesPublic, normalizeSubscriptionUrl } from "@/lib/ics/import.server";
test("blocks non-public", () => {
  for (const ip of ["127.0.0.1","10.1.2.3","169.254.169.254","172.16.0.1","192.168.1.1","100.64.0.1","0.0.0.0","224.0.0.1","192.0.0.8","192.0.2.5","198.51.100.1","203.0.113.9","240.0.0.1","::1","::","fe80::1","fc00::1","fd12::1","ff02::1","::ffff:127.0.0.1","::ffff:7f00:1","2001:db8::1","2001:db8:ffff::1","64:ff9b::a00:1","2002:a00:1::","2001::1","3fff::1","3fff:fff::1"]) expect(isNonPublicIp(ip), ip).toBe(true);
});
test("malformed addresses fail closed", () => {
  for (const ip of ["2001:garbage","1:2:3:4:5:6:7:8:9","2606::4700::1","999.1.1.1","","not-an-ip","fe80::1%eth0"]) expect(isNonPublicIp(ip), ip).toBe(true);
});
test("allows public", () => {
  for (const ip of ["17.253.144.10","8.8.8.8","192.1.0.1","2606:4700::1111","2a00:1450:4001::200e","2001:db9::1","2001:4860:4860::8888","2400::1"]) expect(isNonPublicIp(ip), ip).toBe(false);
});
test("rejects http", () => { expect(() => assertPublicFeedUrl(new URL("http://p01-calendars.icloud.com/x"))).toThrow(); });
test("rejects IP literal hosts even when public", () => {
  for (const u of ["https://8.8.8.8/calendar.ics","https://[2606:4700::1111]/c.ics","https://134744072/c.ics"]) expect(() => assertPublicFeedUrl(new URL(u)), u).toThrow();
});
test("keeps legitimate hostnames", () => {
  expect(normalizeSubscriptionUrl("webcal://p01-calendars.icloud.com/published/2/abc")).toBe("https://p01-calendars.icloud.com/published/2/abc");
});
afterEach(() => vi.unstubAllGlobals());
const dns = (by: Record<string, unknown>) => vi.stubGlobal("fetch", vi.fn(async (u: string) => {
  const type = new URL(u).searchParams.get("type")!;
  return new Response(JSON.stringify(by[type]), { status: 200 });
}));
const sig = () => new AbortController().signal;
test("DNS failure status in either family rejects", async () => {
  dns({ A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }] }, AAAA: { Status: 2 } });
  await expect(assertResolvesPublic("example.com", sig())).rejects.toThrow();
  dns({ A: { Status: 3 }, AAAA: { Status: 3 } });
  await expect(assertResolvesPublic("example.com", sig())).rejects.toThrow();
});
test("DNS public answers pass, mixed/empty fail", async () => {
  dns({ A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }] }, AAAA: { Status: 0 } });
  await expect(assertResolvesPublic("example.com", sig())).resolves.toBeUndefined();
  dns({ A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }, { type: 1, data: "10.0.0.1" }] }, AAAA: { Status: 0 } });
  await expect(assertResolvesPublic("example.com", sig())).rejects.toThrow();
  dns({ A: { Status: 0 }, AAAA: { Status: 0 } });
  await expect(assertResolvesPublic("example.com", sig())).rejects.toThrow();
});
test("malformed brackets and embedded IPv4 fail closed", () => {
  for (const ip of ["[2606:4700::1","2606:4700::1]","[[2606:4700::1]]","[8.8.8.8]","2606:4700::192.168.001.001","::ffff:1.2.3","::ffff:1.2.3.256","08.8.8.8"," 8.8.8.8","2606:4700::1 ","12345::1","::1::","1:2:3:4:5:6:7"]) expect(isNonPublicIp(ip), ip).toBe(true);
});
test("valid compressed and embedded-IPv4 IPv6 follow policy", () => {
  expect(isNonPublicIp("2606:4700::1")).toBe(false);
  expect(isNonPublicIp("[2606:4700::1]")).toBe(false);
  expect(isNonPublicIp("2606:4700::192.168.1.1")).toBe(false); // global prefix; tail is just bits
  expect(isNonPublicIp("::ffff:8.8.8.8")).toBe(true); // mapped space is outside 2000::/3
});
test("AS112 and AMT IPv4 ranges are globally reachable", () => {
  for (const ip of ["192.31.196.1","192.52.193.1"]) expect(isNonPublicIp(ip), ip).toBe(false);
});
test("malformed DNS answers reject the lookup", async () => {
  const cases = [
    { A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }, {}] }, AAAA: { Status: 0 } },
    { A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }, { type: 1, data: "" }] }, AAAA: { Status: 0 } },
    { A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.010" }] }, AAAA: { Status: 0 } },
    { A: { Status: 0, Answer: [{ type: 1, data: "2606:4700::1" }] }, AAAA: { Status: 0 } },
    { A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }] }, AAAA: { Status: 0, Answer: [{ type: 28, data: "2606:zz::1" }] } },
    { A: { Status: 0, Answer: [{ type: 1, data: "17.253.144.10" }] }, AAAA: { Status: 0, Answer: [{ type: 28, data: "8.8.8.8" }] } },
    { A: { Status: 0, Answer: "nope" }, AAAA: { Status: 0 } },
  ];
  for (const c of cases) { dns(c); await expect(assertResolvesPublic("example.com", sig())).rejects.toThrow(); }
});
test("CNAME chains with valid answers pass", () => {
  expect(readDnsAnswers({ Answer: [{ type: 5, data: "x.example." }, { type: 28, data: "2606:4700::1" }] }, 28)).toEqual(["2606:4700::1"]);
});
