import { afterEach, describe, expect, it, vi } from "vitest";

const { execFile, platform } = vi.hoisted(() => ({
  execFile: vi.fn(),
  platform: vi.fn(() => "linux"),
}));
vi.mock("child_process", () => ({ execFile, execFileSync: vi.fn() }));
vi.mock("os", () => ({ default: { platform } }));
import { getListeningPorts } from "@/lib/server/platform";

afterEach(() => { vi.resetAllMocks(); platform.mockReturnValue("linux"); });

function output(text: string, error: Error | null = null) {
  execFile.mockImplementation((_command, _args, _options, callback) => {
    queueMicrotask(() => callback(error, text, ""));
  });
}

describe("listening port snapshot", () => {
  it("reads IPv4, IPv6 and wildcard listeners in a single Linux scan", async () => {
    output("LISTEN 0 128 127.0.0.1:3001 0.0.0.0:*\nLISTEN 0 128 [::]:9001 [::]:*\nLISTEN 0 128 *:8080 *:*\n");
    expect(await getListeningPorts()).toEqual(new Set([3001, 9001, 8080]));
    expect(execFile).toHaveBeenCalledExactlyOnceWith("ss", ["-tlnH"], expect.objectContaining({ timeout: 3000 }), expect.any(Function));
  });

  it("reads macOS lsof name fields without counting process IDs or duplicate sockets", async () => {
    platform.mockReturnValue("darwin");
    output("p123\nn*:3001\np124\nn[::1]:9001\nn*:3001\n");
    expect(await getListeningPorts()).toEqual(new Set([3001, 9001]));
    expect(execFile.mock.calls[0][0]).toBe("lsof");
  });

  it("returns no running ports when the scan fails or has no listeners", async () => {
    output("", new Error("no listeners"));
    expect(await getListeningPorts()).toEqual(new Set());
  });
});
