/**
 * CertificatePreview — the "what a Stimuli IQ certificate looks like" band.
 *
 * Shown on `/verify` (so a first-time visitor can see WHERE on the document the
 * Certificate ID they are being asked for is printed) and on `/about` (as the proof
 * behind the "certificates employers can check" claim). Every `/programs/[slug]` page
 * shows the artwork too, via `CertificateSpecimens` — the band's images without its
 * heading and callouts.
 *
 * TWO SPECIMENS, because there are two awards. A programme can end in an internship
 * certificate, a training certificate, or both, and they are separate documents with
 * separate IDs — showing only one left visitors assuming the other did not exist.
 *
 * WHY THE ARTWORK IS WATERMARKED
 * ------------------------------
 * These are the only images of a Stimuli IQ certificate anyone can fetch over HTTP.
 * Every other part of the document is protected — the authorised signature is read from a
 * private server directory and never gets a URL, the serial is registered, the cert_uid is
 * signed — so a clean picture of the blank certificate is the one thing a forger could get
 * from us. The word SAMPLE is composited INTO the pixels by
 * `scripts/build-sample-certificates.cjs`, not laid over the image in CSS: an overlay
 * disappears the moment the file is right-click-saved, which is precisely when it would
 * have mattered. It is tiled small across the whole document rather than printed once
 * large, so it lands on the name, the ID, the seal and the signature block at once and no
 * single crop or clone-stamp removes it. The badge below is a label for sighted visitors,
 * not the protection.
 *
 * The artwork also keeps its placeholder values ("Your Name", "DOMAIN",
 * `STIQ-2026-000001`) so it reads as a specimen rather than as somebody's real award. A
 * live certificate carries the holder's name, the programme, its own unique Certificate
 * ID and the issue date, all filled in by the server-side renderer.
 *
 * Server component — the images and copy are static.
 */
import Image from "next/image";

const SPECIMENS = [
  {
    label: "Internship certificate",
    src: "/images/sample-certificate-internship.webp",
    alt: "Specimen Stimuli IQ internship certificate of completion, watermarked SAMPLE, showing where the holder name, programme, Certificate ID and date of issue appear.",
  },
  {
    label: "Training certificate",
    src: "/images/sample-certificate-training.webp",
    alt: "Specimen Stimuli IQ training certificate of completion, watermarked SAMPLE, showing where the holder name, programme, Certificate ID and date of issue appear.",
  },
];

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

/**
 * CertificateSpecimens — just the two watermarked documents, no heading and no callouts.
 *
 * Split out of the band below so the program detail pages can show the artwork inside
 * their own "Earn a Verifiable Certificate" card without dragging in a second <h2> and a
 * duplicate set of callouts. One definition of the files and the alt text, two placements.
 */
export function CertificateSpecimens({
  className,
  sizes = "(min-width: 768px) 46vw, 100vw",
}: {
  className?: string;
  /** Passed to next/image. Override where the container is narrower than the band. */
  sizes?: string;
}) {
  return (
    /* The two specimens stay side by side from md up. They are wide documents, and a
       single column of full-width certificates pushes everything after them off the fold. */
    <div className={["grid grid-cols-1 gap-6 md:grid-cols-2", className].filter(Boolean).join(" ")}>
      {SPECIMENS.map((specimen) => (
        <figure key={specimen.src} className="m-0">
          {/* 3:2 artwork. `object-contain` on a locked aspect box: the certificate's own
              border must never be cropped, or the specimen stops looking like a document. */}
          <div className="relative aspect-[3/2] overflow-hidden rounded-2xl border border-border bg-card shadow-md">
            <Image src={specimen.src} alt={specimen.alt} fill sizes={sizes} className="object-contain" />
            <span className="absolute left-3 top-3 rounded-full bg-fg/85 px-3 py-1 text-xs font-bold uppercase tracking-widest text-bg">
              Sample
            </span>
          </div>
          <figcaption className="mt-3 text-center text-sm font-semibold text-fg">
            {specimen.label}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

CertificateSpecimens.displayName = "CertificateSpecimens";

export function CertificatePreview({
  heading = "What a Stimuli IQ certificate looks like",
  subheading = "Programmes finish with an internship certificate, a training certificate, or both. Each is a separate document with its own Certificate ID — the code you enter above to confirm it is genuine.",
  className,
}: {
  heading?: string;
  subheading?: string;
  className?: string;
}) {
  return (
    <section
      aria-label="Sample certificates"
      data-testid="certificate-preview"
      className={["section-band py-16 lg:py-20", className].filter(Boolean).join(" ")}
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">{heading}</h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">{subheading}</p>
        </div>

        <CertificateSpecimens />

        <ul role="list" className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {CALLOUTS.map((item) => (
            <li key={item.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-base font-bold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

CertificatePreview.displayName = "CertificatePreview";
