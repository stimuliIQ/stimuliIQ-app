/**
 * CertificatePreview — the "what a Stimuli IQ certificate looks like" band.
 *
 * Shown on `/verify` (so a first-time visitor can see WHERE on the document the
 * Certificate ID they are being asked for is printed) and on `/about` (as the proof
 * behind the "certificates employers can check" claim).
 *
 * The image is the approved artwork with its placeholder values still in place
 * ("Your Name", "DOMAIN NAME") — deliberately, so it reads as a specimen rather than
 * as somebody's real certificate. A live certificate carries the holder's name, the
 * programme, its own unique Certificate ID and the issue date, all filled in by the
 * server-side renderer.
 *
 * Server component — the image and copy are static.
 */
import Image from "next/image";

const CALLOUTS = [
  {
    title: "Unique Certificate ID",
    body: "Every certificate carries its own ID, printed under the body text. That is the code you enter to verify it.",
  },
  {
    title: "Holder, programme and date",
    body: "The name, the programme completed, and the date of issue are set when the certificate is awarded — they cannot be edited afterwards.",
  },
  {
    title: "Authorised signature",
    body: "Signed by the founder and issued under a verifiable record, so an employer can confirm the document against our register.",
  },
];

export function CertificatePreview({
  heading = "What a Stimuli IQ certificate looks like",
  subheading = "Every programme finishes with a certificate like this one. The Certificate ID printed on it is what you enter above to confirm the document is genuine.",
  className,
}: {
  heading?: string;
  subheading?: string;
  className?: string;
}) {
  return (
    <section
      aria-label="Sample certificate"
      data-testid="certificate-preview"
      className={["section-band py-16 lg:py-20", className].filter(Boolean).join(" ")}
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">{heading}</h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">{subheading}</p>
        </div>

        {/* At md the certificate KEEPS the full width — it is a wide document, and squeezing
            it into a ~350px pane makes the specimen unreadable, which defeats the section.
            Instead the three callouts (which used to stack as three full-width slabs all the
            way to 1024px) become a 3-up row beneath it. */}
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr]">
          {/* 3:2 artwork. `object-contain` on a locked aspect box: the certificate's own
              border must never be cropped, or the specimen stops looking like a document. */}
          <div className="relative aspect-[3/2] overflow-hidden rounded-2xl border border-border bg-card shadow-md md:col-span-2 lg:col-span-1">
            <Image
              src="/images/sample-certificate.webp"
              alt="Specimen Stimuli IQ certificate of completion, showing where the holder name, programme, Certificate ID and date of issue appear."
              fill
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="object-contain"
            />
          </div>

          <ul role="list" className="flex flex-col gap-5 md:col-span-2 md:grid md:grid-cols-3 lg:col-span-1 lg:flex lg:flex-col">
            {CALLOUTS.map((item) => (
              <li key={item.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="text-base font-bold text-fg">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

CertificatePreview.displayName = "CertificatePreview";
