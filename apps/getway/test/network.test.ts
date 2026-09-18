import { describe, expect, it } from "vitest";
import {
  describeHostReachability,
  expandHostAlias,
  listLanAddresses,
  resolveReachableAddresses,
  validateHost,
} from "../src/shared/network.js";

const fakeInterfaces = (
  entries: Array<{ address: string; family: string | number; internal: boolean }>,
): Record<string, readonly unknown[]> => ({ en0: entries });

describe("network", () => {
  describe("describeHostReachability", () => {
    it("detects loopback hosts", () => {
      expect(describeHostReachability("127.0.0.1")).toBe("loopback");
      expect(describeHostReachability("localhost")).toBe("loopback");
      expect(describeHostReachability("LOCALHOST")).toBe("loopback");
      expect(describeHostReachability("127.0.0.53")).toBe("loopback");
      expect(describeHostReachability("::1")).toBe("loopback");
    });

    it("detects wildcard hosts", () => {
      expect(describeHostReachability("0.0.0.0")).toBe("wildcard");
      expect(describeHostReachability("::")).toBe("wildcard");
    });

    it("treats any other address as specific", () => {
      expect(describeHostReachability("192.168.1.23")).toBe("specific");
      expect(describeHostReachability("10.0.0.5")).toBe("specific");
    });
  });

  describe("listLanAddresses", () => {
    it("keeps non-internal IPv4 addresses only", () => {
      const result = listLanAddresses(
        fakeInterfaces([
          { address: "127.0.0.1", family: "IPv4", internal: true },
          { address: "::1", family: "IPv6", internal: true },
          { address: "192.168.1.23", family: "IPv4", internal: false },
          { address: "fe80::1", family: "IPv6", internal: false },
        ]),
      );
      expect(result).toEqual(["192.168.1.23"]);
    });

    it("accepts the numeric family used by older Node builds", () => {
      const result = listLanAddresses(
        fakeInterfaces([{ address: "10.0.0.5", family: 4, internal: false }]),
      );
      expect(result).toEqual(["10.0.0.5"]);
    });

    it("drops link-local addresses that cannot be shared", () => {
      const result = listLanAddresses(
        fakeInterfaces([
          { address: "169.254.12.34", family: "IPv4", internal: false },
          { address: "192.168.1.23", family: "IPv4", internal: false },
        ]),
      );
      expect(result).toEqual(["192.168.1.23"]);
    });

    it("drops the RFC 2544 benchmark range used by fake-ip proxies", () => {
      const result = listLanAddresses(
        fakeInterfaces([
          { address: "198.18.0.1", family: "IPv4", internal: false },
          { address: "198.19.255.254", family: "IPv4", internal: false },
          { address: "198.20.0.1", family: "IPv4", internal: false },
          { address: "192.168.1.23", family: "IPv4", internal: false },
        ]),
      );
      expect(result).toEqual(["192.168.1.23", "198.20.0.1"]);
    });

    it("deduplicates and sorts by numeric octet", () => {
      const result = listLanAddresses(
        fakeInterfaces([
          { address: "192.168.1.9", family: "IPv4", internal: false },
          { address: "192.168.1.23", family: "IPv4", internal: false },
          { address: "192.168.1.23", family: "IPv4", internal: false },
          { address: "10.0.0.5", family: "IPv4", internal: false },
        ]),
      );
      expect(result).toEqual(["10.0.0.5", "192.168.1.9", "192.168.1.23"]);
    });

    it("tolerates missing or malformed entries", () => {
      const result = listLanAddresses({
        en0: [undefined, null, "garbage", {}],
      });
      expect(result).toEqual([]);
    });
  });

  describe("resolveReachableAddresses", () => {
    const lan = ["10.0.0.5", "192.168.1.23"];

    it("returns nothing when bound to loopback", () => {
      expect(resolveReachableAddresses("127.0.0.1", lan)).toEqual([]);
      expect(resolveReachableAddresses("localhost", lan)).toEqual([]);
    });

    it("returns every lan address when bound to wildcard", () => {
      expect(resolveReachableAddresses("0.0.0.0", lan)).toEqual(lan);
    });

    it("returns only the bound address when it is a lan address", () => {
      expect(resolveReachableAddresses("192.168.1.23", lan)).toEqual([
        "192.168.1.23",
      ]);
    });

    it("returns nothing when the bound address is not a lan address", () => {
      expect(resolveReachableAddresses("203.0.113.7", lan)).toEqual([]);
    });

    it("treats the `lan` alias as wildcard", () => {
      expect(resolveReachableAddresses("lan", lan)).toEqual(lan);
    });
  });

  describe("expandHostAlias", () => {
    it("turns `lan` into the wildcard address", () => {
      expect(expandHostAlias("lan")).toBe("0.0.0.0");
      expect(expandHostAlias("LAN")).toBe("0.0.0.0");
      expect(expandHostAlias("  lan  ")).toBe("0.0.0.0");
    });

    it("leaves any other value untouched", () => {
      expect(expandHostAlias("127.0.0.1")).toBe("127.0.0.1");
      expect(expandHostAlias("192.168.1.23")).toBe("192.168.1.23");
    });
  });

  describe("validateHost", () => {
    const lan = ["192.168.1.23", "10.0.0.5"];

    it("accepts loopback, wildcard and the lan alias", () => {
      expect(validateHost("127.0.0.1", lan).ok).toBe(true);
      expect(validateHost("localhost", lan).ok).toBe(true);
      expect(validateHost("0.0.0.0", lan).ok).toBe(true);
      expect(validateHost("lan", lan).ok).toBe(true);
    });

    it("accepts an address this machine actually has", () => {
      expect(validateHost("192.168.1.23", lan).ok).toBe(true);
    });

    it("rejects an address that is not on this machine", () => {
      const result = validateHost("192.168.99.99", lan);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The message must be actionable, not just "invalid".
        expect(result.message).toContain("192.168.1.23");
        expect(result.message).toContain("--host");
      }
    });

    it("rejects junk and explains the accepted forms", () => {
      const result = validateHost("abc", lan);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // 提示里要给出「不带值 --host」这个最短写法。
        expect(result.message).toContain("--host");
        expect(result.message).toContain("不带值");
      }
      expect(validateHost("300.1.1.1", lan).ok).toBe(false);
    });
  });
});
