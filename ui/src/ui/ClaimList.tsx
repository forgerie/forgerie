import { BadgeCheckIcon, CircleHelpIcon, MessageCircleIcon, TelescopeIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseClaims, type Confidence } from "./markdown/richBlockSyntax";
import "./ClaimList.css";

const ICONS: Record<Confidence, LucideIcon> = {
  verified: BadgeCheckIcon, inferred: TelescopeIcon, opinion: MessageCircleIcon, unknown: CircleHelpIcon,
};
const LABELS: Record<Confidence, string> = { verified: "Verified", inferred: "Inferred", opinion: "Opinion", unknown: "Unknown" };

/**
 * System molecule: findings, each tagged with how sure the writer is. The
 * label is text, not only colour, so the confidence survives in every theme
 * and for a screen reader. Evidence sits under its claim in a quieter voice.
 */
export function ClaimList({ code, labels = LABELS }: { code: string; labels?: Record<Confidence, string> }) {
  const { title, claims } = parseClaims(code);
  if (title === "" && claims.length === 0) return null;
  return <section className="claim-list" aria-label={title || undefined}>
    {title !== "" && <div className="claim-list-title">{title}</div>}
    <ul className="claim-list-items" role="list">
      {claims.map((claim, index) => {
        const Icon = ICONS[claim.confidence];
        return <li key={index} className="claim-list-item" data-confidence={claim.confidence}>
          <span className="claim-list-badge"><Icon className="claim-list-icon" aria-hidden="true" />{labels[claim.confidence]}</span>
          <div className="claim-list-body">
            <MarkdownFragment inline text={claim.text} />
            {claim.detail !== "" && <div className="claim-list-detail"><MarkdownFragment text={claim.detail} /></div>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
