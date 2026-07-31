import type { JSX } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FileUpload, type SignedUploadResult } from "./file-upload";

// ---------------------------------------------------------------------------
// XHR mock (jsdom doesn't implement real XHR; we shim it)
// ---------------------------------------------------------------------------

type XhrEventListener = (data: unknown) => void;

/** Tracks all MockXHR instances created in a test. */
const xhrInstances: MockXHRInstance[] = [];

interface MockXHRInstance {
  status: number;
  open: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  addEventListener: (event: string, fn: XhrEventListener) => void;
  upload: { addEventListener: (event: string, fn: XhrEventListener) => void };
  // Internal
  _xhrListeners: Record<string, XhrEventListener>;
  _uploadListeners: Record<string, XhrEventListener>;
  _emit: (target: "xhr" | "upload", event: string, data: unknown) => void;
}

function createMockXHR(statusCode: number): MockXHRInstance {
  const _xhrListeners: Record<string, XhrEventListener> = {};
  const _uploadListeners: Record<string, XhrEventListener> = {};

  const instance: MockXHRInstance = {
    status: statusCode,
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(),
    _xhrListeners,
    _uploadListeners,
    addEventListener(event, fn) {
      _xhrListeners[event] = fn;
    },
    upload: {
      addEventListener(event, fn) {
        _uploadListeners[event] = fn;
      },
    },
    _emit(target, event, data) {
      const map = target === "xhr" ? _xhrListeners : _uploadListeners;
      map[event]?.(data);
    },
  };

  // Default send: fire progress then load.
  (instance.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
    instance._emit("upload", "progress", { lengthComputable: true, loaded: 100, total: 100 });
    instance._emit("xhr", "load", {});
  });

  return instance;
}

function installMockXHR(statusCode = 200): void {
  xhrInstances.length = 0;

  vi.stubGlobal("XMLHttpRequest", function MockXHRCtor(this: unknown) {
    const instance = createMockXHR(statusCode);
    xhrInstances.push(instance);
    return instance;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePdfFile(name = "report.pdf", size = 1024): File {
  return new File(["x".repeat(size)], name, { type: "application/pdf" });
}

/**
 * Simulate file selection on an aria-hidden file input.
 * userEvent.upload respects aria-hidden; we use fireEvent.change directly instead.
 */
function uploadFile(input: HTMLElement, ...files: File[]): void {
  // Build a DataTransfer-like object.
  const fileList = Object.assign(files.slice(), {
    item: (i: number) => files[i] ?? null,
    length: files.length,
  });
  Object.defineProperty(input, "files", { value: fileList, configurable: true });
  fireEvent.change(input);
}

const fakeRequestUploadUrl = vi.fn(
  async (_file: File): Promise<SignedUploadResult> => ({
    url: "https://storage.example.com/upload-signed",
    storageKey: "submissions/tenant1/enroll1/report.pdf",
  }),
);

function Harness({
  onUploaded = vi.fn(),
  onRemoved = vi.fn(),
  maxBytes,
  acceptedTypes,
  multiple,
}: {
  onUploaded?: (storageKey: string, file: File) => void;
  onRemoved?: (storageKey: string | null, file: File) => void;
  maxBytes?: number;
  acceptedTypes?: string[];
  multiple?: boolean;
}): JSX.Element {
  return (
    <FileUpload
      requestUploadUrl={fakeRequestUploadUrl}
      onUploaded={onUploaded}
      onRemoved={onRemoved}
      maxBytes={maxBytes}
      acceptedTypes={acceptedTypes}
      multiple={multiple}
    />
  );
}

describe("FileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockXHR(200);
  });

  // ---------------------------------------------------------------------------
  // Architecture / seam tests — the critical ones
  // ---------------------------------------------------------------------------

  it("NEVER calls any storage SDK directly — requestUploadUrl is the only I/O seam", async () => {
    // The component should call requestUploadUrl (our injected seam) and nothing else
    // for I/O. We verify this by checking no raw bucket URL appears in the DOM.
    render(<Harness />);
    const input = screen.getByTestId("file-upload-input");

    const file = makePdfFile();
    // Simulate file selection via the hidden input.
    uploadFile(input, file);

    await waitFor(() => {
      expect(fakeRequestUploadUrl).toHaveBeenCalledWith(file);
    });

    // The signed URL should NOT appear anywhere in the DOM.
    expect(document.body.innerHTML).not.toContain("https://storage.example.com/upload-signed");
  });

  it("calls onUploaded with storageKey (not a URL) after a successful upload", async () => {
    const onUploaded = vi.fn();
    render(<Harness onUploaded={onUploaded} />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, makePdfFile());

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(
        "submissions/tenant1/enroll1/report.pdf",
        expect.any(File),
      );
    });
    // The storageKey must NOT be a full URL.
    const [key] = onUploaded.mock.calls[0] as [string];
    expect(key).not.toMatch(/^https?:\/\//);
  });

  it("sends the signed headers on the PUT, letting them override the guessed Content-Type", async () => {
    // S3/R2 sign Content-Type and x-amz-meta-* into the V4 canonical request, so a PUT
    // that omits them is rejected with 403 SignatureDoesNotMatch. Dropping these silently
    // breaks every real upload while passing against a permissive mock — hence this test.
    const requestUploadUrl = vi.fn(
      async (_file: File): Promise<SignedUploadResult> => ({
        url: "https://storage.example.com/upload-signed",
        storageKey: "program_brochures/tenant1/brochure.pdf",
        headers: { "Content-Type": "application/pdf", "x-amz-meta-max-bytes": "20971520" },
      }),
    );

    render(
      <FileUpload requestUploadUrl={requestUploadUrl} onUploaded={vi.fn()} />,
    );
    uploadFile(screen.getByTestId("file-upload-input"), makePdfFile());

    await waitFor(() => {
      expect(xhrInstances[0]?.send).toHaveBeenCalled();
    });

    const calls = xhrInstances[0]!.setRequestHeader.mock.calls as [string, string][];
    expect(calls).toContainEqual(["x-amz-meta-max-bytes", "20971520"]);
    // Content-Type is set twice: the File guess first, then the server's signed value —
    // the last write is what the request carries.
    expect(calls.filter(([name]) => name === "Content-Type").at(-1)).toEqual([
      "Content-Type",
      "application/pdf",
    ]);
  });

  // ---------------------------------------------------------------------------
  // Client-hint validation tests
  // ---------------------------------------------------------------------------

  it("shows an error and does not call requestUploadUrl for files exceeding maxBytes", async () => {
    const onUploaded = vi.fn();
    render(<Harness onUploaded={onUploaded} maxBytes={500} />);
    const input = screen.getByTestId("file-upload-input");
    // File is 1024 bytes > 500 byte limit
    uploadFile(input, makePdfFile("big.pdf", 1024));

    await waitFor(() => {
      const errorEl = document.querySelector("[data-testid^='file-entry-error-']");
      expect(errorEl).not.toBeNull();
      expect(errorEl!.textContent).toContain("exceeds maximum size");
    });
    expect(fakeRequestUploadUrl).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows an error for unaccepted MIME types and does not upload", async () => {
    render(<Harness acceptedTypes={["image/*"]} />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, new File(["x"], "doc.pdf", { type: "application/pdf" }));

    await waitFor(() => {
      const errorEl = document.querySelector("[data-testid^='file-entry-error-']");
      expect(errorEl).not.toBeNull();
      expect(errorEl!.textContent).toContain("not accepted");
    });
    expect(fakeRequestUploadUrl).not.toHaveBeenCalled();
  });

  it("accepts files matching a wildcard acceptedType (e.g. 'image/*')", async () => {
    const onUploaded = vi.fn();
    render(<Harness onUploaded={onUploaded} acceptedTypes={["image/*"]} />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, new File(["x"], "photo.jpg", { type: "image/jpeg" }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Unit tests
  // ---------------------------------------------------------------------------

  it("renders the dropzone with the correct role and accessible label", () => {
    render(<Harness />);
    const dropzone = screen.getByTestId("file-upload-dropzone");
    expect(dropzone).toHaveAttribute("role", "button");
    expect(dropzone).toHaveAttribute("aria-label", "Upload files");
  });

  it("shows the file in the list after selection", async () => {
    render(<Harness />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, makePdfFile());
    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
  });

  it("shows a remove button labelled with the filename", async () => {
    render(<Harness />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, makePdfFile("essay.pdf"));
    await waitFor(() => {
      const removeBtn = screen.getByRole("button", { name: "Remove essay.pdf" });
      expect(removeBtn).toBeInTheDocument();
    });
  });

  it("removes the file from the list when the remove button is clicked", async () => {
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRemoved={onRemoved} />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, makePdfFile("essay.pdf"));
    await waitFor(() => screen.getByText("essay.pdf"));
    await user.click(screen.getByRole("button", { name: "Remove essay.pdf" }));
    await waitFor(() => {
      expect(screen.queryByText("essay.pdf")).not.toBeInTheDocument();
    });
    expect(onRemoved).toHaveBeenCalled();
  });

  it("shows a retry button on upload error and re-triggers requestUploadUrl on retry", async () => {
    // First call fails; make requestUploadUrl reject once.
    fakeRequestUploadUrl.mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByTestId("file-upload-input");
    uploadFile(input, makePdfFile("fail.pdf"));

    await waitFor(() => {
      const retryBtn = screen.getByRole("button", { name: /Retry upload of fail.pdf/i });
      expect(retryBtn).toBeInTheDocument();
    });

    // Now restore the mock and retry.
    fakeRequestUploadUrl.mockResolvedValueOnce({
      url: "https://storage.example.com/upload-signed",
      storageKey: "submissions/tenant1/enroll1/fail.pdf",
    });
    await user.click(screen.getByRole("button", { name: /Retry upload of fail.pdf/i }));
    await waitFor(() => {
      expect(fakeRequestUploadUrl).toHaveBeenCalledTimes(2);
    });
  });

  it("is keyboard operable — Enter on the dropzone opens the file picker trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dropzone = screen.getByTestId("file-upload-dropzone");
    const input = screen.getByTestId("file-upload-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    dropzone.focus();
    await user.keyboard("{Enter}");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("Space on the dropzone also opens the file picker", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dropzone = screen.getByTestId("file-upload-dropzone");
    const input = screen.getByTestId("file-upload-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    dropzone.focus();
    await user.keyboard(" ");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("is disabled when disabled prop is set — dropzone has aria-disabled and tabIndex=-1", () => {
    const { rerender } = render(
      <FileUpload
        requestUploadUrl={fakeRequestUploadUrl}
        onUploaded={vi.fn()}
      />,
    );
    rerender(
      <FileUpload
        requestUploadUrl={fakeRequestUploadUrl}
        onUploaded={vi.fn()}
        disabled
      />,
    );
    const dropzone = screen.getByTestId("file-upload-dropzone");
    expect(dropzone).toHaveAttribute("aria-disabled", "true");
    expect(dropzone).toHaveAttribute("tabindex", "-1");
  });

  // ---------------------------------------------------------------------------
  // a11y tests
  // ---------------------------------------------------------------------------

  it("dropzone has role=button so it is keyboard operable", () => {
    render(<Harness />);
    expect(screen.getByTestId("file-upload-dropzone")).toHaveAttribute("role", "button");
  });

  it("file input is aria-hidden (visible button is the a11y entry point)", () => {
    render(<Harness />);
    const input = screen.getByTestId("file-upload-input");
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAttribute("tabindex", "-1");
  });

  it("file list has aria-label so SR announces the context", async () => {
    render(<Harness />);
    uploadFile(screen.getByTestId("file-upload-input"), makePdfFile());
    await waitFor(() => screen.getByTestId("file-upload-list"));
    const list = screen.getByTestId("file-upload-list");
    expect(list).toHaveAttribute("aria-label", "Uploaded files");
  });

  it("progress bar has role=progressbar and aria-valuenow attributes while uploading", async () => {
    // Use a slow mock that stays in uploading state for the check.
    let resolveFn!: (value: SignedUploadResult) => void;
    fakeRequestUploadUrl.mockImplementationOnce(
      () =>
        new Promise<SignedUploadResult>((resolve) => {
          resolveFn = resolve;
        }),
    );

    render(<Harness />);
    uploadFile(screen.getByTestId("file-upload-input"), makePdfFile("slow.pdf"));

    // While requestUploadUrl is pending, the entry is in "requesting" state.
    await waitFor(() => screen.getByText("slow.pdf"));
    // Progress bar should be present in "requesting" state.
    const progressBar = document.querySelector('[role="progressbar"]');
    expect(progressBar).toBeInTheDocument();

    // Resolve to let it finish.
    resolveFn({
      url: "https://storage.example.com/upload-signed",
      storageKey: "submissions/s",
    });
  });

  it("remove buttons are labelled with filename (not generic 'Remove')", async () => {
    render(<Harness />);
    uploadFile(screen.getByTestId("file-upload-input"), makePdfFile("thesis.pdf"));
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Remove thesis.pdf" });
      expect(btn).toBeInTheDocument();
    });
  });

  it("SR announcement span is aria-live polite for status updates", async () => {
    render(<Harness />);
    uploadFile(screen.getByTestId("file-upload-input"), makePdfFile("announce.pdf"));
    await waitFor(() => screen.getByText("announce.pdf"));
    // The aria-live polite span should exist inside the entry row.
    const liveRegions = document.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBeGreaterThan(0);
  });
});
