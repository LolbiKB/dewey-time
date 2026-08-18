/**
 * The link as a scannable code.
 *
 * Encoded in the browser and sent nowhere: the value IS the credential, so a
 * hosted QR service would hand every issued link to a third party while
 * looking identical on screen.
 *
 * `qrcode-generator` directly rather than a React wrapper around it. The
 * obvious wrapper (react-qr-code) is that same encoder plus `prop-types`,
 * which React 19 ignores entirely — dead weight in the bundle for a component
 * that is nine lines of SVG. Building the nodes here also avoids
 * dangerouslySetInnerHTML, which the library's own createSvgTag would force.
 *
 * Dark modules on white in BOTH themes. An inverted QR fails to scan on a lot
 * of phone cameras, and it fails in the worst place — in front of the
 * employee, reading as "the code doesn't work" rather than as a theming bug.
 * That is why the panel sets its own background instead of inheriting the
 * dialog's.
 */
import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** The clear border the QR spec requires. Without it the code still LOOKS
 *  right and refuses to scan against a busy background. */
const QUIET_ZONE = 4;

export function TelegramLinkQr(props: { url: string }) {
  const { path, size } = useMemo(() => {
    // Type 0 picks the smallest version that fits; "M" tolerates ~15% damage,
    // which is the usual choice for a screen that nobody is going to smudge.
    const qr = qrcode(0, "M");
    qr.addData(props.url);
    qr.make();

    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        // One 1x1 subpath per dark module, all in a single <path>. A <rect>
        // each would be thousands of elements for one code.
        if (qr.isDark(row, col)) {
          d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { path: d, size: count + QUIET_ZONE * 2 };
  }, [props.url]);

  return (
    <div className="flex justify-center rounded-lg bg-white p-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={200}
        height={200}
        // Without this the browser anti-aliases every module edge and the
        // seams read as noise to a camera.
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR code for the Telegram link"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
