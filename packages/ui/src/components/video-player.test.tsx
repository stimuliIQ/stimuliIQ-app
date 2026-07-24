import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

import { VideoPlayer, type CreateHlsEngine } from "./video-player";

// ---------------------------------------------------------------------------
// Helpers — mock canPlayType behavior
// ---------------------------------------------------------------------------

/**
 * jsdom's HTMLVideoElement.canPlayType always returns "".
 * Helper to mock it as truthy for native HLS tests.
 */
function mockNativeHlsSupport(supported: boolean): void {
  vi.spyOn(HTMLVideoElement.prototype, "canPlayType").mockImplementation((type: string) => {
    if (type === "application/vnd.apple.mpegurl") {
      return supported ? "probably" : "";
    }
    return "";
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe("VideoPlayer — rendering", () => {
  it("renders a <video> element", () => {
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" />);
    expect(screen.getByTestId("video-element")).toBeInTheDocument();
  });

  it("renders within the video-player container", () => {
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" />);
    expect(screen.getByTestId("video-player")).toBeInTheDocument();
  });

  it("applies controls attribute to the native video element", () => {
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" />);
    const video = screen.getByTestId("video-element");
    expect(video).toHaveAttribute("controls");
  });

  it("passes poster to the video element", () => {
    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        poster="https://cdn.example.com/poster.jpg"
      />,
    );
    expect(screen.getByTestId("video-element")).toHaveAttribute(
      "poster",
      "https://cdn.example.com/poster.jpg",
    );
  });

  it("applies custom data-testid", () => {
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" data-testid="my-player" />);
    expect(screen.getByTestId("my-player")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Native HLS path — canPlayType returns truthy
// ---------------------------------------------------------------------------

describe("VideoPlayer — native HLS (Safari)", () => {
  it("sets video.src directly when native HLS is supported", () => {
    mockNativeHlsSupport(true);
    render(<VideoPlayer src="https://cdn.example.com/native.m3u8" />);
    const video = screen.getByTestId("video-element") as HTMLVideoElement;
    // After component mounts, the effect sets video.src
    expect(video.src).toBe("https://cdn.example.com/native.m3u8");
  });

  it("does NOT invoke createHlsEngine when native HLS is available", () => {
    mockNativeHlsSupport(true);
    const engineFactory = vi.fn<CreateHlsEngine>(() => ({ destroy: vi.fn() }));
    render(
      <VideoPlayer
        src="https://cdn.example.com/native.m3u8"
        createHlsEngine={engineFactory}
      />,
    );
    expect(engineFactory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Injected HLS engine seam — canPlayType returns falsy
// ---------------------------------------------------------------------------

describe("VideoPlayer — injected HLS engine seam", () => {
  it("invokes createHlsEngine with the video element and src when native HLS unavailable", () => {
    mockNativeHlsSupport(false);
    const destroyFn = vi.fn();
    const engineFactory = vi.fn<CreateHlsEngine>((_video, _src) => ({
      destroy: destroyFn,
    }));

    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        createHlsEngine={engineFactory}
      />,
    );

    expect(engineFactory).toHaveBeenCalledTimes(1);
    const [videoArg, srcArg] = engineFactory.mock.calls[0] as [HTMLVideoElement, string];
    expect(videoArg).toBeInstanceOf(HTMLVideoElement);
    expect(srcArg).toBe("https://cdn.example.com/test.m3u8");
  });

  it("calls engine.destroy() when the component unmounts", () => {
    mockNativeHlsSupport(false);
    const destroyFn = vi.fn();
    const engineFactory = vi.fn<CreateHlsEngine>(() => ({ destroy: destroyFn }));

    const { unmount } = render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        createHlsEngine={engineFactory}
      />,
    );
    unmount();
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Unplayable fallback (no native HLS, no engine)
// ---------------------------------------------------------------------------

describe("VideoPlayer — unplayable fallback", () => {
  it("renders the error fallback when browser cannot play HLS and no engine is provided", async () => {
    mockNativeHlsSupport(false);
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" />);

    await waitFor(() => {
      expect(screen.getByTestId("video-player-error")).toBeInTheDocument();
    });
  });

  it("calls onError when the browser cannot play HLS and no engine is provided", async () => {
    mockNativeHlsSupport(false);
    const onError = vi.fn();
    render(
      <VideoPlayer src="https://cdn.example.com/test.m3u8" onError={onError} />,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    const firstCall = onError.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(typeof firstCall?.[0]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// onReady and onTimeUpdate and onEnded via dispatched events
// ---------------------------------------------------------------------------

describe("VideoPlayer — event callbacks", () => {
  it("calls onReady when loadedmetadata fires", async () => {
    mockNativeHlsSupport(true);
    const onReady = vi.fn();

    render(
      <VideoPlayer src="https://cdn.example.com/test.m3u8" onReady={onReady} />,
    );

    const video = screen.getByTestId("video-element");
    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("calls onTimeUpdate with currentTime when timeupdate fires", async () => {
    mockNativeHlsSupport(true);
    const onTimeUpdate = vi.fn();

    render(
      <VideoPlayer src="https://cdn.example.com/test.m3u8" onTimeUpdate={onTimeUpdate} />,
    );

    const video = screen.getByTestId("video-element") as HTMLVideoElement;
    // Set currentTime manually (jsdom allows this)
    Object.defineProperty(video, "currentTime", { value: 42.5, writable: true, configurable: true });

    await act(async () => {
      video.dispatchEvent(new Event("timeupdate"));
    });

    expect(onTimeUpdate).toHaveBeenCalledTimes(1);
    expect(onTimeUpdate).toHaveBeenCalledWith(42.5);
  });

  it("calls onEnded when the ended event fires", async () => {
    mockNativeHlsSupport(true);
    const onEnded = vi.fn();

    render(
      <VideoPlayer src="https://cdn.example.com/test.m3u8" onEnded={onEnded} />,
    );

    const video = screen.getByTestId("video-element");
    await act(async () => {
      video.dispatchEvent(new Event("ended"));
    });

    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// startPositionS — resume seek
// ---------------------------------------------------------------------------

describe("VideoPlayer — startPositionS resume", () => {
  it("seeks to startPositionS when loadedmetadata fires", async () => {
    mockNativeHlsSupport(true);

    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        startPositionS={120}
      />,
    );

    const video = screen.getByTestId("video-element") as HTMLVideoElement;

    // Make currentTime writable (jsdom doesn't throw on assignment, just doesn't persist)
    let storedTime = 0;
    Object.defineProperty(video, "currentTime", {
      get: () => storedTime,
      set: (v: number) => { storedTime = v; },
      configurable: true,
    });

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(storedTime).toBe(120);
  });

  it("does not seek when startPositionS is 0", async () => {
    mockNativeHlsSupport(true);

    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        startPositionS={0}
      />,
    );

    const video = screen.getByTestId("video-element") as HTMLVideoElement;
    let seekCalled = false;
    Object.defineProperty(video, "currentTime", {
      get: () => 0,
      set: () => { seekCalled = true; },
      configurable: true,
    });

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(seekCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

describe("VideoPlayer — watermark", () => {
  it("renders the watermark element when watermarkText is provided", () => {
    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        watermarkText="Priya Sharma · STU-001042"
      />,
    );
    expect(screen.getByTestId("video-player-watermark")).toBeInTheDocument();
  });

  it("watermark element is aria-hidden (decorative)", () => {
    render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        watermarkText="Priya Sharma · STU-001042"
      />,
    );
    expect(screen.getByTestId("video-player-watermark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("does not render the watermark when watermarkText is omitted", () => {
    render(<VideoPlayer src="https://cdn.example.com/test.m3u8" />);
    expect(screen.queryByTestId("video-player-watermark")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Caption tracks
// ---------------------------------------------------------------------------

describe("VideoPlayer — captions", () => {
  it("renders <track> elements for each caption", () => {
    const { container } = render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        captions={[
          { src: "/en.vtt", srclang: "en", label: "English", default: true },
          { src: "/hi.vtt", srclang: "hi", label: "Hindi" },
        ]}
      />,
    );
    const tracks = container.querySelectorAll("track");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toHaveAttribute("srclang", "en");
    expect(tracks[1]).toHaveAttribute("srclang", "hi");
  });

  it("sets kind='captions' on every track", () => {
    const { container } = render(
      <VideoPlayer
        src="https://cdn.example.com/test.m3u8"
        captions={[{ src: "/en.vtt", srclang: "en", label: "English" }]}
      />,
    );
    const track = container.querySelector("track");
    expect(track).toHaveAttribute("kind", "captions");
  });
});
