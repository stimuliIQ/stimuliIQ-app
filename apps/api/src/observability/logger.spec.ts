import { Writable } from "node:stream";
import pino from "pino";
import { loggerModuleOptions, REDACT_PATHS } from "./logger";

function createSink(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

/** Builds a plain (non-HTTP) pino logger from the SAME options object used in
 *  production, minus the pino-http-only fields (`transport` would spin up a worker
 *  thread; `genReqId` is HTTP-request-specific) — the redact/hooks/formatters config
 *  under test is shared verbatim. */
function buildTestLogger(stream: Writable): pino.Logger {
  const { transport: _transport, genReqId: _genReqId, ...rest } = loggerModuleOptions.pinoHttp as Record<
    string,
    unknown
  >;
  return pino(rest as pino.LoggerOptions, stream);
}

describe("REDACT_PATHS — Rule H-4/AC-47", () => {
  it("covers the auth header, cookie header, csrf header, and set-cookie response header", () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-csrf-token']",
        "res.headers['set-cookie']",
      ]),
    );
  });
});

describe("pino logger config — redaction + PII masking (functional)", () => {
  it("redacts the Authorization header from the emitted log line", () => {
    const { lines, stream } = createSink();
    const logger = buildTestLogger(stream);

    logger.info({ req: { headers: { authorization: "Bearer secret-token-xyz" } } }, "handled request");

    const output = lines.join("");
    expect(output).not.toContain("secret-token-xyz");
  });

  it("redacts the cookie header from the emitted log line", () => {
    const { lines, stream } = createSink();
    const logger = buildTestLogger(stream);

    logger.info({ req: { headers: { cookie: "access_token=super-secret-cookie-value" } } }, "handled request");

    const output = lines.join("");
    expect(output).not.toContain("super-secret-cookie-value");
  });

  it("masks an email found in the log MESSAGE text (hooks.logMethod)", () => {
    const { lines, stream } = createSink();
    const logger = buildTestLogger(stream);

    logger.info("Sending confirmation to jane@example.com");

    const output = lines.join("");
    expect(output).not.toContain("jane@example.com");
    expect(output).toContain("j***@e***.com");
  });

  it("masks a phone number found in the log MESSAGE text (hooks.logMethod)", () => {
    const { lines, stream } = createSink();
    const logger = buildTestLogger(stream);

    logger.info("Sending OTP to +919876541234");

    const output = lines.join("");
    expect(output).not.toContain("9876541234");
  });

  it("masks an email found in a plain log OBJECT field (formatters.log)", () => {
    const { lines, stream } = createSink();
    const logger = buildTestLogger(stream);

    logger.info({ email: "jane@example.com" }, "user created");

    const output = lines.join("");
    expect(output).not.toContain("jane@example.com");
  });

  it("never mutates the caller's original log object", () => {
    const { stream } = createSink();
    const logger = buildTestLogger(stream);
    const payload = { email: "jane@example.com" };

    logger.info(payload, "user created");

    expect(payload.email).toBe("jane@example.com");
  });
});
