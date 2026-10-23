import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { McpSettings } from "./McpSettings";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
const saveMcp = vi.fn();
const listMcp = vi.fn();
const server = { id: "search", name: "Search", identifier: "search", transport: "http", enabled: true, status: "connected", tools: [], configuration: { url: "https://example.com/mcp", headers: [{ key: "Authorization", hasValue: true }] } };

beforeEach(() => {
  listMcp.mockResolvedValue([]);
  saveMcp.mockReset().mockImplementation(async (input) => ({ ...server, ...input }));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { capabilities: { listMcp, saveMcp, onChanged: () => () => {} } } });
});

function choose(value: "Enabled" | "Disabled") {
  fireEvent.click(screen.getByRole("button", { name: "Service status" }));
  fireEvent.click(screen.getByRole("option", { name: value }));
}

test("new MCP services default to enabled and can be created disabled", async () => {
  render(<McpSettings />);
  await screen.findByText("No MCP services");
  fireEvent.click(screen.getByRole("button", { name: "Add service" }));
  expect(screen.getByRole("button", { name: "Service status" }).textContent).toContain("Enabled");
  fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "Search" } });
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com/mcp" } });
  choose("Disabled");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveMcp).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  await screen.findByText("Disabled");
  expect(screen.getByRole("button", { name: "Reconnect" }).hasAttribute("disabled")).toBe(true);
});

test("editing can disable and re-enable a service without replacing masked credentials", async () => {
  listMcp.mockResolvedValue([server]);
  render(<McpSettings />);
  await screen.findByText("Search");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  choose("Disabled");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveMcp).toHaveBeenCalledOnce());
  expect(saveMcp.mock.calls[0][0].enabled).toBe(false);
  expect(saveMcp.mock.calls[0][0].configuration).not.toHaveProperty("headers");
  await screen.findByText("Disabled");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Service status" }).textContent).toContain("Disabled");
  choose("Enabled");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveMcp).toHaveBeenCalledTimes(2));
  expect(saveMcp.mock.calls[1][0].enabled).toBe(true);
});

test("explicitly edited headers are still submitted", async () => {
  listMcp.mockResolvedValue([server]);
  render(<McpSettings />);
  await screen.findByText("Search");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Headers (JSON)"), { target: { value: '{"X-Test":"value"}' } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveMcp).toHaveBeenCalledOnce());
  expect(saveMcp.mock.calls[0][0].configuration.headers).toEqual({ "X-Test": "value" });
});
