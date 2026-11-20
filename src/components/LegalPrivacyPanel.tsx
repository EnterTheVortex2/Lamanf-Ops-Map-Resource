import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  HardDrive,
  Scale,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type { OperatorProfileMeta, OperatorSlotId } from "../utils/operatorStorage";

interface StorageSummary {
  builtTotal: number;
  tasksTotal: number;
  keysTotal: number;
  pinsTotal: number;
}

interface LegalPrivacyPanelProps {
  operatorProfiles: OperatorProfileMeta[];
  activeOperatorId: OperatorSlotId;
  storageSummary: StorageSummary;
  onExportBackup: () => void;
  onRestoreBackup: (rawJson: string) => {
    ok: boolean;
    message: string;
  };
  onEraseAllData: () => void;
}

const REFERENCE_LINKS = [
  {
    label: "ICO UK GDPR Guidance",
    desc: "UK Information Commissioner's Office data protection resources",
    href: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/",
  },
  {
    label: "ICO — Raise a Data Complaint",
    desc: "How to raise a data protection concern with the UK regulator",
    href: "https://ico.org.uk/make-a-complaint/",
  },
  {
    label: "Google Cloud Privacy Notice",
    desc: "Hosting infrastructure transport & network processing terms",
    href: "https://cloud.google.com/terms/cloud-privacy-notice",
  },
  {
    label: "Google Cloud Data Processing Addendum",
    desc: "Processor terms and international data transfer safeguards",
    href: "https://cloud.google.com/terms/data-processing-addendum",
  },
  {
    label: "GZW Wiki Copyrights (CC BY-SA)",
    desc: "Community guide & task walkthrough licensing attribution",
    href: "https://gray-zone-warfare.fandom.com/wiki/Gray_Zone_Warfare_Wiki:Copyrights",
  },
];

export function LegalPrivacyPanel({
  operatorProfiles,
  activeOperatorId,
  storageSummary,
  onExportBackup,
  onRestoreBackup,
  onEraseAllData,
}: LegalPrivacyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const res = onRestoreBackup(text);
      setActionFeedback({
        tone: res.ok ? "success" : "error",
        text: res.message,
      });
      setConfirmErase(false);
    } catch {
      setActionFeedback({
        tone: "error",
        text: "Could not read the selected backup file.",
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#080b10] text-[#e2e8f0]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Hero Header */}
        <section className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#94a3b8]">
            <span>Privacy, Legal &amp; Data Controls</span>
            <span aria-hidden="true">·</span>
            <span>Local-First Companion</span>
            <span aria-hidden="true">·</span>
            <span>Notice last updated: 20 November 2026</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#f8fafc] mt-2">
            Your progress. Your control.
          </h1>
          <p className="text-sm text-[#cbd5e1] leading-relaxed max-w-3xl mt-2">
            Lamang Operations is a private hobby &amp; tactical companion for{" "}
            <strong className="text-white font-semibold">Gray Zone Warfare</strong>. This notice
            explains transparently what browser and network data the app uses, how Screen Sync
            works locally on your device, and how to export, restore, or erase everything saved.
            It describes the app for informational clarity and is not formal legal compliance
            certification.
          </p>
        </section>

        {/* Main 2-Column Content + Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_350px] gap-6 items-start">
          {/* Left Column: Structured Privacy & Legal Sections */}
          <div className="space-y-4">
            {/* 1. What is processed */}
            <article className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#e5a93c] shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#f8fafc]">
                  What is processed
                </h2>
              </div>
              <div className="space-y-2.5 text-[13.5px] text-[#cbd5e1] leading-relaxed">
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Progress &amp; Operator Profiles (Saved on Your Device):
                  </strong>{" "}
                  The app does not require registration, login credentials, or a central player
                  account. It stores only what you enter locally for your three operator slots (
                  {operatorProfiles.map((p) => p.name).join(", ")}), including operator display
                  names, chosen faction, Hideout built/planned upgrade status, stash material
                  counts, completed tasks, owned keys, map material ticks, custom recon pins and
                  notes, and workspace layout width.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Screen Sync &amp; Compass Watcher (Volatile Memory Only):
                  </strong>{" "}
                  If you choose to enable Monitor-2 Screen Sync, your browser&apos;s built-in
                  screen capture (<code className="font-mono-tabular text-xs text-[#7dd3fc]">getDisplayMedia</code>)
                  analyses frames from your selected game window locally in browser memory using
                  Canvas pixel matching and client-side OCR (<code className="font-mono-tabular text-xs text-[#7dd3fc]">Tesseract.js</code>)
                  to detect your player arrow, grid coordinates, and top-HUD compass direction.{" "}
                  <strong className="text-white">
                    No screenshots, video frames, or screen captures are ever uploaded, recorded,
                    transmitted, or saved to any server.
                  </strong>{" "}
                  Closing or stopping Screen Sync immediately terminates browser capture access.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    No Game Hooks &amp; No Sensitive Info:
                  </strong>{" "}
                  The app never connects to your Steam or game account, does not read game memory
                  or files, and performs no background telemetry. Do not enter personal, private,
                  or sensitive information into operator names or custom pin notes.
                </p>
              </div>
            </article>

            {/* 2. Where your data goes */}
            <article className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-[#38bdf8] shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#f8fafc]">
                  Where your data goes
                </h2>
              </div>
              <div className="space-y-2.5 text-[13.5px] text-[#cbd5e1] leading-relaxed">
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Device-Local Progress:
                  </strong>{" "}
                  All operator progress, custom pins, and stash counts remain inside this
                  browser&apos;s local storage unless you explicitly click{" "}
                  <strong className="text-white">Export my progress</strong> to save a backup file
                  yourself. Nothing is synced to a shared cloud database or visible to other
                  players.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Read-Only Game Data &amp; Map Tile Proxy:
                  </strong>{" "}
                  To display Update 0.5 item stats, task walkthroughs, building reference photos,
                  and satellite map tiles, the app server proxies and briefly caches public
                  community game data from{" "}
                  <code className="font-mono-tabular text-xs text-[#94a3b8]">gzw-data.dev</code>,{" "}
                  <code className="font-mono-tabular text-xs text-[#94a3b8]">cdn.gzwtacmap.com</code>,
                  and{" "}
                  <code className="font-mono-tabular text-xs text-[#94a3b8]">gray-zone-warfare.fandom.com</code>.
                  No operator progress, custom pins, or personal identifiers are sent with those
                  requests.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Hosting Infrastructure &amp; External Links:
                  </strong>{" "}
                  The hosting platform (Google Cloud Run) processes standard HTTP network and
                  transport metadata (such as IP address, TLS routing, user-agent, and timestamps)
                  under its own privacy and security policies. No advertising networks, behavioural
                  analytics trackers, or location-tracking APIs are included. External wiki or legal
                  guidance links contact those third-party websites only when you choose to open
                  them.
                </p>
              </div>
            </article>

            {/* 3. Storage, cookies and retention */}
            <article className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="w-4 h-4 text-[#34d399] shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#f8fafc]">
                  Storage, cookies and retention
                </h2>
              </div>
              <div className="space-y-2.5 text-[13.5px] text-[#cbd5e1] leading-relaxed">
                <p>
                  Operator slots, progress snapshots, UI panel widths, and cached public item/wiki
                  snapshots are stored locally in this browser&apos;s{" "}
                  <code className="font-mono-tabular text-xs text-[#7dd3fc]">localStorage</code>{" "}
                  (<code className="font-mono-tabular text-xs text-[#94a3b8]">lamang_ops_*</code>{" "}
                  keys) strictly as functional features you request. No advertising, cross-site
                  tracking, or profiling cookies are used (in alignment with UK PECR rules for
                  strictly necessary / user-requested local storage).
                </p>
                <p>
                  A shared browser profile or shared computer is not encrypted private storage:
                  anyone with access to this browser profile can view or edit saved progress. Local
                  data is retained until you overwrite it, clear browser site data, or click{" "}
                  <strong className="text-white">Erase my app data</strong>. Hosting provider
                  operational logs and backups follow the hosting provider&apos;s standard retention
                  schedules; immediate deletion from provider system backups is not promised.
                </p>
              </div>
            </article>

            {/* 4. Purpose, lawful basis and UK data protection */}
            <article className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2.5">
                <Scale className="w-4 h-4 text-[#e5a93c] shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#f8fafc]">
                  Purpose, lawful basis &amp; UK data protection
                </h2>
              </div>
              <div className="space-y-2.5 text-[13.5px] text-[#cbd5e1] leading-relaxed">
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Purpose &amp; Lawful Basis:
                  </strong>{" "}
                  We process minimal hosting transport metadata and provide local-storage tools for
                  our legitimate interests in running a fast, secure private gaming companion. There
                  is no advertising, profiling, or sale of personal data. Where UK GDPR applies, you
                  have the right to access, correct, erase, or object to processing of your data,
                  and the right to complain to the{" "}
                  <strong className="text-white">UK Information Commissioner&apos;s Office (ICO)</strong>.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Household Use vs. Wider Public Release:
                  </strong>{" "}
                  Purely personal or household use by an individual or small circle of invited
                  friends may fall outside UK GDPR. Wider public release changes that assessment: if
                  distributed publicly, the operator should publish a dedicated controller contact
                  email, document the lawful basis and responsibilities under UK GDPR and the Data
                  Protection Act 2018 (as amended), and review hosting processor terms and
                  international transfer safeguards before rollout.
                </p>
              </div>
            </article>

            {/* 5. Unofficial Fan Companion, Fair Play & Disclaimers */}
            <article className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#e5a93c] shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#f8fafc]">
                  Unofficial fan notice, fair play &amp; disclaimers
                </h2>
              </div>
              <div className="space-y-2.5 text-[13.5px] text-[#cbd5e1] leading-relaxed">
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Non-Affiliation &amp; Intellectual Property:
                  </strong>{" "}
                  Lamang Operations is an independent, unofficial fan-made companion app and is{" "}
                  <strong className="text-white">
                    not affiliated with, endorsed by, sponsored by, or connected to MADFINGER Games,
                    a.s.
                  </strong>{" "}
                  or <em>Gray Zone Warfare</em>. All game trademarks, faction names, map imagery,
                  and in-game terminology belong to their respective owners. Community dataset and
                  walkthrough content is attributed to <code className="text-xs text-[#94a3b8]">gzw-data.dev</code>{" "}
                  and the Gray Zone Warfare Fandom Wiki (CC BY-SA).
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    Fair Play &amp; External-Only Operation:
                  </strong>{" "}
                  This tool runs solely inside a standard web browser as a tactical map, hideout
                  tracker, and optional second-monitor visual reference. It never inspects or
                  modifies game memory, binaries, config files, or network traffic. You remain
                  solely responsible for complying with MADFINGER Games&apos; Terms of Service and
                  EULA when using external companion tools.
                </p>
                <p>
                  <strong className="text-[#f1f5f9] font-semibold">
                    No Warranty (&ldquo;As-Is&rdquo;) &amp; Minimum Age:
                  </strong>{" "}
                  Map markers, loot tiers, key doors, prices, and task walkthroughs are provided
                  &ldquo;as is&rdquo; without warranty of accuracy or uninterrupted availability, as
                  game patches may change spawns or objectives. To the fullest extent permitted by
                  law, the app maintainer is not liable for gameplay or indirect losses from using
                  this companion. Not directed at children under 13 (or 16 where applicable).
                </p>
              </div>
            </article>
          </div>

          {/* Right Column: Data Controls, Contact & Guidance Links */}
          <aside className="space-y-4 lg:sticky lg:top-6">
            {/* Access, Export, Restore & Erasure Controls */}
            <section className="bg-[#141b26] border border-white/[0.09] rounded-xl p-5 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#f8fafc]">
                  Access, export and erasure
                </h2>
                <p className="text-xs text-[#94a3b8] mt-1 leading-relaxed">
                  Manage everything saved in this browser across all 3 operator slots (active:{" "}
                  <span className="text-[#e2e8f0] font-medium">
                    {operatorProfiles.find((p) => p.id === activeOperatorId)?.name || "Operator 1"}
                  </span>
                  ).
                </p>
              </div>

              {/* Live Local Storage Telemetry */}
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#0a0e14] border border-white/[0.07] p-3">
                <div>
                  <div className="text-[11px] text-[#7f8ea1]">Built Upgrades</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#f8fafc] mt-0.5">
                    {storageSummary.builtTotal}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7f8ea1]">Completed Tasks</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#f8fafc] mt-0.5">
                    {storageSummary.tasksTotal}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7f8ea1]">Owned Keys</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#f8fafc] mt-0.5">
                    {storageSummary.keysTotal}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7f8ea1]">Custom Pins</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#f8fafc] mt-0.5">
                    {storageSummary.pinsTotal}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onExportBackup();
                    setActionFeedback({
                      tone: "success",
                      text: "Exported full progress backup (.json).",
                    });
                  }}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#e5a93c] hover:bg-[#eab654] text-[#090d12] text-xs font-semibold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export my progress</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Choose progress backup JSON file"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#0a0e14] hover:bg-[#101722] border border-white/[0.12] hover:border-[#38bdf8]/60 text-[#e2e8f0] hover:text-white text-xs font-medium transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Restore a progress backup</span>
                </button>

                {!confirmErase ? (
                  <button
                    type="button"
                    onClick={() => setConfirmErase(true)}
                    className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#0a0e14] hover:bg-red-950/35 border border-white/[0.1] hover:border-red-500/50 text-red-300 hover:text-red-200 text-xs font-medium transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Erase my app data</span>
                  </button>
                ) : (
                  <div className="rounded-lg bg-red-950/30 border border-red-500/45 p-3 space-y-2.5">
                    <p className="text-xs text-red-200 leading-relaxed">
                      This permanently removes all saved operators, Hideout plans, tasks, keys,
                      stash counts, custom pins, and cached data from this browser.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onEraseAllData();
                          setConfirmErase(false);
                          setActionFeedback({
                            tone: "success",
                            text: "All local app data has been erased and reset.",
                          });
                        }}
                        className="flex-1 min-h-[36px] px-3 py-1.5 rounded-md bg-red-500 hover:bg-red-400 text-white text-xs font-semibold transition-colors"
                      >
                        Confirm erase
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmErase(false)}
                        className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#0a0e14] border border-white/[0.12] text-xs font-medium text-[#cbd5e1] hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {actionFeedback && (
                <div
                  role="status"
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    actionFeedback.tone === "success"
                      ? "bg-emerald-950/35 border-emerald-500/40 text-emerald-200"
                      : "bg-red-950/35 border-red-500/40 text-red-200"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{actionFeedback.text}</span>
                </div>
              )}
            </section>

            {/* Controller & Operator Contact */}
            <section className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 space-y-2">
              <h2 className="font-display text-sm font-semibold text-[#f8fafc]">
                Controller &amp; contact details
              </h2>
              <p className="text-xs text-[#cbd5e1] leading-relaxed">
                Operated as a private fan companion by the site maintainer. Deleting progress here
                only clears this browser&apos;s local data and does not alter any separate browser
                or external cloud account.
              </p>
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                Before any wider public release, publish a dedicated support contact email here for
                access, correction, erasure, or objection requests.
              </p>
            </section>

            {/* ICO & Provider Policy Links */}
            <section className="bg-[#0e131b] border border-white/[0.08] rounded-xl p-5 space-y-2.5">
              <h2 className="font-display text-sm font-semibold text-[#f8fafc]">
                Guidance &amp; provider links
              </h2>
              <div className="divide-y divide-white/[0.06]">
                {REFERENCE_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start justify-between gap-2 py-2.5 first:pt-1 last:pb-1 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#7dd3fc] group-hover:text-[#bae6fd] group-hover:underline">
                        {link.label}
                      </div>
                      <div className="text-[11px] text-[#7f8ea1] mt-0.5 leading-snug">
                        {link.desc}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[#7f8ea1] group-hover:text-[#7dd3fc] shrink-0 mt-0.5" />
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
