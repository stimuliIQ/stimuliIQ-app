// Unit tests for ImageKeyField's device-upload upgrade: happy path sets the key via
// `onUploadedKey`, client-side validation rejects oversize/wrong-type files WITHOUT ever
// calling `mediaUploadUrl`, and a failed PUT surfaces an error toast while leaving
// `onUploadedKey` uncalled (the field stays untouched). Manual key entry (the pre-existing
// text `Input`) is unaffected by this pass and isn't re-tested here.
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@repo/ui";

import { ImageKeyField } from "./image-key-field";

const mediaUploadUrlMock = vi.fn();

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    crm: {
      contentPages: {
        mediaUploadUrl: (...args: unknown[]) => mediaUploadUrlMock(...args),
      },
    },
  },
}));

function renderField(onUploadedKey = vi.fn()) {
  const registered = { name: "backgroundImageKey", onChange: vi.fn(), onBlur: vi.fn(), ref: vi.fn() };
  render(
    <ToastProvider>
      <ImageKeyField
        watchedValue=""
        registered={registered}
        testId="hero-background-image-key"
        onUploadedKey={onUploadedKey}
      />
    </ToastProvider>,
  );
  return { onUploadedKey };
}

function pngFile(name: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(Math.max(sizeBytes, 1))], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

beforeEach(() => {
  mediaUploadUrlMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImageKeyField — device upload", () => {
  it("happy path: uploads, mints a signed URL, PUTs the file, and sets the key via onUploadedKey", async () => {
    const user = userEvent.setup();
    mediaUploadUrlMock.mockResolvedValue({
      storageKey: "content-pages/abc/hero-bg.png",
      uploadUrl: "https://storage.example.com/signed-put",
      expiresAt: "2026-07-21T01:00:00.000Z",
      maxSizeBytes: 5 * 1024 * 1024,
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });

    const { onUploadedKey } = renderField();
    const file = pngFile("hero.png", 1024);
    const input = screen.getByTestId("hero-background-image-key-upload-input");

    await user.upload(input, file);

    await waitFor(() => expect(onUploadedKey).toHaveBeenCalledWith("content-pages/abc/hero-bg.png"));
    expect(mediaUploadUrlMock).toHaveBeenCalledWith({
      fileName: "hero.png",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.example.com/signed-put",
      expect.objectContaining({ method: "PUT", headers: expect.objectContaining({ "Content-Type": "image/png" }) }),
    );
    expect(await screen.findByText("Image uploaded")).toBeInTheDocument();
  });

  it("rejects an oversize file client-side with no network call", async () => {
    const user = userEvent.setup();
    const { onUploadedKey } = renderField();
    const bigFile = pngFile("huge.png", 6 * 1024 * 1024); // > 5 MB
    const input = screen.getByTestId("hero-background-image-key-upload-input");

    await user.upload(input, bigFile);

    expect(await screen.findByText("Maximum image size is 5 MB.")).toBeInTheDocument();
    expect(mediaUploadUrlMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(onUploadedKey).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type (svg) client-side with no network call", async () => {
    // applyAccept: false — the real browser's file-picker `accept` filter would normally
    // stop a user from ever selecting a mismatched file, but our validation is
    // defense-in-depth (e.g. a renamed file, or drag-and-drop from outside the picker), so
    // the test bypasses userEvent's accept-matching to exercise it directly.
    const user = userEvent.setup({ applyAccept: false });
    const { onUploadedKey } = renderField();
    const svgFile = new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" });
    const input = screen.getByTestId("hero-background-image-key-upload-input");

    await user.upload(input, svgFile);

    expect(await screen.findByText("Use a JPG, PNG, or WebP file.")).toBeInTheDocument();
    expect(mediaUploadUrlMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(onUploadedKey).not.toHaveBeenCalled();
  });

  it("a failed PUT surfaces an error toast and leaves the field untouched (onUploadedKey never called)", async () => {
    const user = userEvent.setup();
    mediaUploadUrlMock.mockResolvedValue({
      storageKey: "content-pages/abc/hero-bg.png",
      uploadUrl: "https://storage.example.com/signed-put",
      expiresAt: "2026-07-21T01:00:00.000Z",
      maxSizeBytes: 5 * 1024 * 1024,
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });

    const { onUploadedKey } = renderField();
    const file = pngFile("hero.png", 1024);
    const input = screen.getByTestId("hero-background-image-key-upload-input");

    await user.upload(input, file);

    expect(await screen.findByText("Couldn't upload the image — check your connection and try again.")).toBeInTheDocument();
    expect(onUploadedKey).not.toHaveBeenCalled();
  });

  it("also surfaces an error toast and leaves the field untouched when minting the signed URL itself fails", async () => {
    const user = userEvent.setup();
    mediaUploadUrlMock.mockRejectedValue(new Error("network down"));

    const { onUploadedKey } = renderField();
    const file = pngFile("hero.png", 1024);
    const input = screen.getByTestId("hero-background-image-key-upload-input");

    await user.upload(input, file);

    expect(await screen.findByText("Couldn't upload the image — check your connection and try again.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(onUploadedKey).not.toHaveBeenCalled();
  });
});
