import { BadgeCheckIcon, BanIcon, BookCheckIcon, CircleHelpIcon, CircleSlashIcon, ContrastIcon, MessageCircleIcon, TelescopeIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseClaims, type Confidence } from "./markdown/richBlockSyntax";
import "./ClaimList.css";

const ICONS: Record<Confidence, LucideIcon> = {
  verified: BadgeCheckIcon, inferred: TelescopeIcon, opinion: MessageCircleIcon, unknown: CircleHelpIcon,
  supported: BookCheckIcon, partly: ContrastIcon, unsupported: CircleSlashIcon, contradicted: BanIcon,
};
const LABELS: Record<Confidence, string> = {
  verified: "Verified", inferred: "Inferred", opinion: "Opinion", unknown: "Unknown",
  supported: "Supported", partly: "Partly", unsupported: "Unsupported", contradicted: "Contradicted",
};
/** The labels too long for the narrow badge column. */
const WIDE: ReadonlySet<Confidence> = new Set(["supported", "unsupported", "contradicted"]);

/**
 * System molecule: findings, each tagged with how sure the writer is, or with
 * a research verdict on a source's claim. The label is text, not only colour,
 * so the confidence survives in every theme and for a screen reader. Evidence
 * sits under its claim in a quieter voice. A contradicted claim is struck
 * through, so a skimming reader cannot take it as true.
 */
export function ClaimList({ code, labels = LABELS }: { code: string; labels?: Record<Confidence, string> }) {
  const { title, claims } = parseClaims(code);
  if (title === "" && claims.length === 0) return null;
  const wide = claims.some((claim) => WIDE.has(claim.confidence));
  return <section className="claim-list" data-wide={wide || undefined} aria-label={title || undefined}>
    {title !== "" && <div className="claim-list-title">{title}</div>}
    <ul className="claim-list-items" role="list">
      {claims.map((claim, index) => {
        const Icon = ICONS[claim.confidence];
        return <li key={index} className="claim-list-item" data-confidence={claim.confidence}>
          <span className="claim-list-badge"><Icon className="claim-list-icon" aria-hidden="true" />{labels[claim.confidence]}</span>
          <div className="claim-list-body">
            <div className="claim-list-text">
              {claim.confidence === "contradicted" ? <del className="claim-list-struck"><MarkdownFragment inline text={claim.text} /></del> : <MarkdownFragment inline text={claim.text} />}
            </div>
            {claim.detail !== "" && <div className="claim-list-detail"><MarkdownFragment text={claim.detail} /></div>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
