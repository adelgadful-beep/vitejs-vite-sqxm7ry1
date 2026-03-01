import { useState, useMemo } from "react";
import { Paperclip } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────
const PROMPT_BASE = `Eres un asistente experto en diseño y fabricación. Analiza el contenido proporcionado y genera una lista estructurada de piezas con los siguientes campos:
- Pieza: nombre descriptivo del componente
- Cantidad: número de unidades necesarias
- Medidas: dimensiones en cm (ancho x alto x profundidad si aplica)
- Material: material recomendado

Devuelve los datos en formato JSON:
[{"pieza":"...","cantidad":1,"medidas":"...","material":"..."}]`;

const INITIAL_ROWS = [
  { pieza: "Panel Frontal", cantidad: 1,  medidas: "60 x 90 cm", material: "MDF 15mm",    precioUnit: 3500 },
  { pieza: "Panel Lateral", cantidad: 2,  medidas: "30 x 90 cm", material: "MDF 15mm",    precioUnit: 2800 },
  { pieza: "Estante",       cantidad: 3,  medidas: "58 x 30 cm", material: "MDF 18mm",    precioUnit: 2200 },
  { pieza: "Fondo",         cantidad: 1,  medidas: "60 x 90 cm", material: "Triplay 6mm", precioUnit: 4100 },
  { pieza: "Tornillo 3x20", cantidad: 24, medidas: "3 x 20 mm",  material: "Herraje",     precioUnit: 75   },
];

const STRUCTURE_TYPES = [
  { id: "caja-std", label: "Caja Estándar",         icon: "📦" },
  { id: "caja-exp", label: "Caja Explosiva",         icon: "💥" },
  { id: "mueble",   label: "Mueble Básico",          icon: "🛋️" },
  { id: "tokens",   label: "Juego de Mesa (Tokens)", icon: "🎲" },
];

const PALETTE = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6"];

const STEPS = [
  { num:"01", title:"Abre NotebookLM",    desc:"Ve a notebooklm.google.com e inicia sesión.",                  icon:"🌐" },
  { num:"02", title:"Sube tu material",   desc:"Crea un notebook y sube tus documentos o PDFs.",               icon:"📁" },
  { num:"03", title:"Copia la respuesta", desc:"Usa el prompt base en el chat y pega aquí la respuesta JSON.", icon:"📋" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseDims    = s => s.replace(/,/g, ".").split(/[xX×]/).map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
const fmtNum       = n => Number.isInteger(n) ? String(n) : n.toFixed(2);
const clamp        = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtColones   = n => `₡${Number(n).toLocaleString("es-CR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const NON_CUTTABLE = ["herraje","tornillo","clavo","bisagra","perno","tuerca","arandela","screw","bolt"];
const isNonCuttable = r => NON_CUTTABLE.some(k => (r.material + r.pieza).toLowerCase().includes(k));

function nestRects(pieces, sheetW, sheetH, scale) {
  const placed = [], margin = 4;
  let x = margin, y = margin, rowH = 0;
  for (const p of pieces) {
    const pw = clamp(p.w * scale, 4, sheetW - margin * 2);
    const ph = clamp(p.h * scale, 4, sheetH - margin * 2);
    if (x + pw + margin > sheetW) { x = margin; y += rowH + margin; rowH = 0; }
    if (y + ph + margin > sheetH) break;
    placed.push({ ...p, x, y, pw, ph });
    x += pw + margin;
    if (ph > rowH) rowH = ph;
  }
  return placed;
}

// ── SVG generator — uses only ${} template literals ──────────────────────────
function generateSVG(rows, structureType) {
  const W = 800, H = 600, margin = 20;
  let rects = "", labels = "", x = margin, y = margin, rowH = 0, ci = 0;
  const pieces = [];
  rows.forEach(r => {
    const d = parseDims(r.medidas), w = d[0] || 40, h = d[1] || w;
    for (let i = 0; i < Number(r.cantidad); i++) pieces.push({ ...r, w, h });
  });
  const scale = Math.min((W - margin * 2) / Math.max(...pieces.map(p => p.w), 1), 1.5);
  for (const p of pieces) {
    const pw = clamp(p.w * scale, 20, W - margin * 2);
    const ph = clamp(p.h * scale, 20, H - margin * 2);
    const col = PALETTE[ci % PALETTE.length];
    if (x + pw + margin > W) { x = margin; y += rowH + margin; rowH = 0; }
    if (y + ph + margin > H) break;
    rects  += `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="1.5" rx="3"/>`;
    labels += `<text x="${x + pw / 2}" y="${y + ph / 2 + 4}" text-anchor="middle" fill="${col}" font-size="10" font-family="monospace">${p.pieza}</text>`;
    x += pw + margin;
    if (ph > rowH) rowH = ph;
    ci++;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0f1117"/>
  <text x="20" y="18" fill="#64748b" font-size="11" font-family="monospace">Tipo: ${structureType} | ${new Date().toLocaleDateString("es-CR")}</text>
  ${rects}${labels}
</svg>`;
}

// ── PDF / print ───────────────────────────────────────────────────────────────
function printFicha(rows, mode, structureType) {
  const mat = {};
  rows.forEach(r => {
    const k = r.material || "Sin material";
    if (!mat[k]) mat[k] = { qty: 0, total: 0, costo: 0 };
    const d = parseDims(r.medidas);
    const qty = Number(r.cantidad);
    mat[k].qty   += qty;
    mat[k].total += (d[0] || 0) * qty;
    mat[k].costo += (Number(r.precioUnit) || 0) * qty;
  });
  const matRows   = Object.entries(mat).map(([m, v]) =>
    `<tr><td>${m}</td><td>${v.qty}</td><td>${fmtNum(v.total)} cm / ${fmtNum(v.total / 100)} m</td><td>${fmtColones(v.costo)}</td></tr>`
  ).join("");
  const pieceRows = rows.map(r =>
    `<tr><td>${r.pieza}</td><td>${r.cantidad}</td><td>${r.medidas}</td><td>${r.material}</td><td>${fmtColones(r.precioUnit || 0)}</td><td>${fmtColones((r.precioUnit || 0) * r.cantidad)}</td></tr>`
  ).join("");
  const totalGeneral = rows.reduce((s, r) => s + (Number(r.precioUnit) || 0) * Number(r.cantidad), 0);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ficha Técnica</title>
  <style>
    body{font-family:sans-serif;padding:32px;color:#111}
    h1{color:#6366f1}
    table{border-collapse:collapse;width:100%;margin:16px 0}
    th,td{border:1px solid #ddd;padding:8px 12px}
    th{background:#f1f5f9}
    .badge{display:inline-block;padding:4px 12px;border-radius:20px;background:#e0e7ff;color:#4f46e5;font-weight:700}
    .total{text-align:right;font-size:18px;font-weight:700;color:#4f46e5;margin-top:16px}
  </style></head><body>
  <h1>✦ Ficha Técnica — Creador Universal de Plantillas</h1>
  <p><strong>Fecha:</strong> ${new Date().toLocaleDateString("es-CR")} &nbsp;
     <span class="badge">${mode === "canvas" ? "🎨 Canva" : "🔧 Taller"}</span> &nbsp;
     <span class="badge">${structureType}</span></p>
  <h2>Lista de Piezas</h2>
  <table><thead><tr><th>Pieza</th><th>Cantidad</th><th>Medidas</th><th>Material</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
  <tbody>${pieceRows}</tbody></table>
  <h2>Resumen de Materiales</h2>
  <table><thead><tr><th>Material</th><th>Unidades</th><th>Total lineal</th><th>Costo estimado</th></tr></thead>
  <tbody>${matRows}</tbody></table>
  <p class="total">Total estimado del proyecto: ${fmtColones(totalGeneral)}</p>
  </body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ── ISO 3D renderers — all template literals use ${} ─────────────────────────
const ISO = {
  "caja-std": ({ w = 80, h = 60, d = 40, cx = 140, cy = 130 }) => {
    const ix = w * 0.6, iy = h * 0.35, iz = d * 0.6;
    return (
      <g>
        <polygon points={`${cx},${cy} ${cx + ix},${cy - iy} ${cx + ix},${cy - iy - h} ${cx},${cy - h}`}                                              fill="#6366f1" opacity="0.85"/>
        <polygon points={`${cx + ix},${cy - iy} ${cx + ix + iz},${cy} ${cx + ix + iz},${cy - h} ${cx + ix},${cy - iy - h}`}                          fill="#4f46e5" opacity="0.9"/>
        <polygon points={`${cx},${cy - h} ${cx + ix},${cy - iy - h} ${cx + ix + iz},${cy - h} ${cx + iz},${cy - h + iy}`}                            fill="#818cf8" opacity="0.95"/>
        <polygon points={`${cx},${cy} ${cx + ix},${cy - iy} ${cx + ix + iz},${cy} ${cx + iz},${cy + iy}`}                                            fill="#312e81" opacity="0.3"/>
      </g>
    );
  },
  "caja-exp": ({ cx = 140, cy = 110 }) => {
    const faces = [
      { pts: `${cx},${cy} ${cx + 60},${cy} ${cx + 60},${cy + 50} ${cx},${cy + 50}`,                          label: "FRENTE", fill: "#6366f1" },
      { pts: `${cx - 55},${cy} ${cx},${cy} ${cx},${cy + 50} ${cx - 55},${cy + 50}`,                          label: "IZQ",    fill: "#4f46e5" },
      { pts: `${cx + 60},${cy} ${cx + 115},${cy} ${cx + 115},${cy + 50} ${cx + 60},${cy + 50}`,              label: "DER",    fill: "#4f46e5" },
      { pts: `${cx},${cy - 50} ${cx + 60},${cy - 50} ${cx + 60},${cy} ${cx},${cy}`,                          label: "TOP",    fill: "#818cf8" },
      { pts: `${cx},${cy + 50} ${cx + 60},${cy + 50} ${cx + 60},${cy + 90} ${cx},${cy + 90}`,                label: "BASE",   fill: "#818cf8" },
    ];
    return (
      <g>
        {faces.map((f, i) => {
          const xs = f.pts.split(" ").map(p => parseFloat(p.split(",")[0]));
          const ys = f.pts.split(" ").map(p => parseFloat(p.split(",")[1]));
          const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
          const my = ys.reduce((a, b) => a + b, 0) / ys.length;
          return (
            <g key={i}>
              <polygon points={f.pts} fill={f.fill} opacity="0.8" stroke="#1e2433" strokeWidth="1"/>
              <text x={mx} y={my + 4} fill="#e2e8f0" fontSize="9" textAnchor="middle" fontFamily="monospace">{f.label}</text>
            </g>
          );
        })}
      </g>
    );
  },
  "mueble": ({ cx = 100, cy = 160 }) => (
    <g>
      {[0, 100].map(dx => (
        <rect key={dx} x={cx + dx} y={cy - 130} width="14" height="130" fill="#6366f1" opacity="0.8" rx="2"/>
      ))}
      {[0, 40, 80, 120].map((dy, i) => (
        <rect key={i} x={cx} y={cy - dy - 14} width="114" height="10" fill="#818cf8" opacity="0.85" rx="1"/>
      ))}
      <polygon points={`${cx + 114},${cy} ${cx + 134},${cy - 14} ${cx + 134},${cy - 144} ${cx + 114},${cy - 130}`} fill="#4f46e5" opacity="0.5"/>
      <polygon points={`${cx},${cy - 130} ${cx + 114},${cy - 130} ${cx + 134},${cy - 144} ${cx + 20},${cy - 144}`} fill="#818cf8" opacity="0.4"/>
    </g>
  ),
  "tokens": ({ cx = 140, cy = 130 }) => {
    const coins = [
      { r: 38, dx: 0,   dy: 0,   c: "#6366f1" },
      { r: 28, dx: 70,  dy: -20, c: "#8b5cf6" },
      { r: 22, dx: -60, dy: 10,  c: "#0ea5e9" },
      { r: 18, dx: 40,  dy: 50,  c: "#10b981" },
    ];
    return (
      <g>
        {coins.map((c, i) => (
          <g key={i}>
            <ellipse cx={cx + c.dx} cy={cy + c.dy + 8} rx={c.r}       ry={c.r * 0.3}  fill="#000" opacity="0.25"/>
            <circle  cx={cx + c.dx} cy={cy + c.dy}     r={c.r}                         fill={c.c}  opacity="0.85"/>
            <ellipse cx={cx + c.dx} cy={cy + c.dy - c.r * 0.7} rx={c.r * 0.7} ry={c.r * 0.2} fill="#fff" opacity="0.15"/>
          </g>
        ))}
      </g>
    );
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────
const Pill = ({ color, children }) => (
  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${color}22`, color, border: `1px solid ${color}44` }}>
    {children}
  </span>
);

const Card = ({ title, subtitle, children }) => (
  <div style={{ background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 14, padding: "18px 20px" }}>
    {(title || subtitle) && (
      <div style={{ marginBottom: 12 }}>
        {title    && <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>}
        {subtitle && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{subtitle}</div>}
      </div>
    )}
    {children}
  </div>
);

const inputStyle = {
  width: "100%", background: "#0f1117", border: "1px solid #2d3748", borderRadius: 8,
  padding: "10px 13px", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box",
};

// ── NestingViewer ─────────────────────────────────────────────────────────────
function NestingViewer({ rows, mode, paperSize }) {
  const PAPER   = paperSize === "carta" ? { w: 21.59, h: 27.94 } : { w: 21.0, h: 29.7 };
  const sheetW  = mode === "canvas" ? PAPER.w : 122;
  const sheetH  = mode === "canvas" ? PAPER.h : 244;
  const scale   = Math.min((580 - 32) / sheetW, (300 - 32) / sheetH) * 0.92;

  const cuttable    = rows.filter(r => !isNonCuttable(r));
  const nonCuttable = rows.filter(r =>  isNonCuttable(r));

  const pieces = [];
  cuttable.forEach((r, ri) => {
    const d = parseDims(r.medidas), w = d[0] || 10, h = d[1] || w;
    for (let i = 0; i < Math.min(Number(r.cantidad), 8); i++)
      pieces.push({ label: r.pieza, w, h, color: PALETTE[ri % PALETTE.length] });
  });

  const placed    = nestRects(pieces, sheetW * scale + 32, sheetH * scale + 32, scale);
  const usedArea  = placed.reduce((s, p) => s + p.pw * p.ph, 0);
  const totalArea = sheetW * scale * sheetH * scale;
  const waste     = totalArea > 0 ? Math.max(0, 100 - Math.round(usedArea / totalArea * 100)) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>✂️ Plano de Corte / Acomodo</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Lámina: <strong style={{ color: "#94a3b8" }}>
              {mode === "canvas" ? `${paperSize === "carta" ? "Carta" : "A4"} (${sheetW}×${sheetH} cm)` : "Tablón 122×244 cm"}
            </strong>
            &nbsp;·&nbsp;{placed.length}/{pieces.length} piezas acomodadas
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Pill color="#10b981">✅ Uso: {100 - waste}%</Pill>
          <Pill color="#f59e0b">⚠ Desperdicio: {waste}%</Pill>
        </div>
      </div>

      <div style={{ background: "#0d1117", borderRadius: 12, padding: 12, overflowX: "auto", marginBottom: nonCuttable.length ? 12 : 0 }}>
        <svg width={sheetW * scale + 32} height={sheetH * scale + 32} style={{ display: "block", margin: "0 auto" }}>
          <rect x={0} y={0} width={sheetW * scale + 32} height={sheetH * scale + 32} fill="#1a1f2e" rx="6" stroke="#2d3748" strokeWidth="1.5"/>
          {Array.from({ length: Math.floor(sheetW / 10) + 1 }, (_, i) => (
            <line key={i} x1={16 + i * 10 * scale} y1={16} x2={16 + i * 10 * scale} y2={sheetH * scale + 16} stroke="#ffffff08" strokeWidth="1"/>
          ))}
          {placed.map((p, i) => {
            const fs  = Math.max(7, Math.min(11, p.pw / 7));
            const mc  = Math.max(4, Math.floor(p.pw / (fs * 0.55)));
            const lbl = p.label.length > mc ? p.label.slice(0, mc - 1) + "…" : p.label;
            return (
              <g key={i}>
                <rect x={p.x} y={p.y} width={p.pw} height={p.ph} fill={p.color} fillOpacity="0.22" stroke={p.color} strokeWidth="1.5" rx="2"/>
                {p.pw > 22 && p.ph > 14 && (
                  <text x={p.x + p.pw / 2} y={p.y + p.ph / 2 + fs * 0.35} textAnchor="middle" fill={p.color} fontSize={fs} fontFamily="monospace" style={{ pointerEvents: "none" }}>
                    {lbl}
                  </text>
                )}
              </g>
            );
          })}
          <text x={16}                  y={sheetH * scale + 30}  fill="#475569" fontSize="10" fontFamily="monospace">{sheetW} cm</text>
          <text x={sheetW * scale + 20} y={sheetH * scale / 2 + 16} fill="#475569" fontSize="10" fontFamily="monospace"
            transform={`rotate(-90,${sheetW * scale + 26},${sheetH * scale / 2 + 16})`}>{sheetH} cm</text>
        </svg>
      </div>

      {nonCuttable.length > 0 && (
        <div style={{ background: "#1a1f2e", border: "1px solid #334155", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>🔩 Elementos no cortables (herrajes y tornillería)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {nonCuttable.map((r, i) => (
              <div key={i} style={{ background: "#0f1117", border: "1px solid #2d3748", borderRadius: 7, padding: "5px 12px", fontSize: 12, color: "#94a3b8", display: "flex", gap: 6 }}>
                <span style={{ color: PALETTE[i % PALETTE.length], fontWeight: 700 }}>×{r.cantidad}</span>
                <span>{r.pieza}</span>
                <span style={{ color: "#475569" }}>— {r.material}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AssemblyViewer ────────────────────────────────────────────────────────────
function AssemblyViewer({ structureType }) {
  const IsoComp = ISO[structureType] || ISO["caja-std"];
  const st = STRUCTURE_TYPES.find(s => s.id === structureType);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>🧊 Vista Previa de Ensamblaje</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Vista isométrica — {st?.label}</div>
        </div>
        <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #334155", cursor: "not-allowed", fontSize: 12, fontWeight: 600, background: "#1e2433", color: "#64748b", display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <rect x="1" y="1" width="7" height="7" rx="1" stroke="#64748b" strokeWidth="1.5"/>
            <rect x="12" y="1" width="7" height="7" rx="1" stroke="#64748b" strokeWidth="1.5"/>
            <rect x="1" y="12" width="7" height="7" rx="1" stroke="#64748b" strokeWidth="1.5"/>
            <rect x="3" y="3" width="3" height="3" fill="#64748b"/>
            <rect x="14" y="3" width="3" height="3" fill="#64748b"/>
            <rect x="3" y="14" width="3" height="3" fill="#64748b"/>
            <rect x="12" y="12" width="2" height="2" fill="#64748b"/>
            <rect x="15" y="12" width="2" height="5" fill="#64748b"/>
            <rect x="12" y="15" width="5" height="2" fill="#64748b"/>
          </svg>
          Ver en AR (Escanea el QR)
        </button>
      </div>
      <div style={{ background: "#0d1117", borderRadius: 12, padding: 16, display: "flex", justifyContent: "center" }}>
        <svg width="280" height="210" viewBox="0 0 280 210">
          <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#0f1117" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="140" cy="170" rx="100" ry="20" fill="url(#glow)"/>
          <IsoComp/>
        </svg>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
        {["🟣 Frontal", "🔵 Lateral", "🟢 Superior"].map(v => (
          <button key={v} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #1e2433", background: "#1a1f2e", color: "#64748b", fontSize: 11, cursor: "pointer" }}>{v}</button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── MAIN APP ──────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab]               = useState("auto");
  const [visTab, setVisTab]         = useState("nesting");
  const [mode, setMode]             = useState("canvas");
  const [paperSize, setPaperSize]   = useState("carta");
  const [link, setLink]             = useState("");
  const [context, setContext]       = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [copied, setCopied]         = useState(false);
  const [rows, setRows]             = useState(INITIAL_ROWS);
  const [generated, setGenerated]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [structureType, setStructureType] = useState("caja-std");
  const [maxW, setMaxW] = useState(""); const [maxH, setMaxH] = useState(""); const [maxD, setMaxD] = useState("");
  const [scaled, setScaled]         = useState(false);

  const PAPER       = paperSize === "carta" ? { w: 21.59, h: 27.94, label: "Carta" } : { w: 21.0, h: 29.7, label: "A4" };
  const sizeWarning = mode === "canvas" && rows.some(r => { const d = parseDims(r.medidas); return d[0] > PAPER.w || (d[1] && d[1] > PAPER.h); });

  const materialSummary = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const m = r.material.trim() || "Sin material";
      const d = parseDims(r.medidas);
      if (!map[m]) map[m] = { total: 0, pieces: 0, area: 0, costo: 0 };
      const qty = Number(r.cantidad) || 0;
      const lin = d[0] || 0;
      map[m].total  += lin * qty;
      map[m].pieces += qty;
      map[m].area   += d[1] ? lin * d[1] * qty : 0;
      map[m].costo  += (Number(r.precioUnit) || 0) * qty;
    });
    return Object.entries(map).map(([mat, v]) => ({ mat, ...v }));
  }, [rows]);

  const totalCosto = rows.reduce((s, r) => s + (Number(r.precioUnit) || 0) * Number(r.cantidad), 0);

  const copyPrompt = () => { navigator.clipboard.writeText(PROMPT_BASE); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const updateRow  = (i, f, v) => { const u = [...rows]; u[i] = { ...u[i], [f]: v }; setRows(u); };
  const addRow     = () => setRows([...rows, { pieza: "", cantidad: 1, medidas: "", material: "", precioUnit: 0 }]);
  const removeRow  = i => setRows(rows.filter((_, idx) => idx !== i));

  const applyScale = () => {
    const w = parseFloat(maxW), h = parseFloat(maxH), d = parseFloat(maxD);
    if (!w && !h && !d) return;
    setRows(rows.map(r => {
      const dims = parseDims(r.medidas);
      if (!dims.length) return r;
      let ratio = 1;
      if (w && dims[0]) ratio = Math.min(ratio, w / dims[0]);
      if (h && dims[1]) ratio = Math.min(ratio, h / dims[1]);
      if (d && dims[2]) ratio = Math.min(ratio, d / dims[2]);
      return { ...r, medidas: dims.map(v => fmtNum(+(v * ratio).toFixed(2))).join(" x ") + " cm" };
    }));
    setScaled(true); setTimeout(() => setScaled(false), 2500);
  };

  const downloadCSV = () => {
    const esc = v => `"${String(v).replace(/,/g, ".").replace(/"/g, '""')}"`;
    const header = ["Pieza", "Cantidad", "Medidas", "Material", "Precio Unit (₡)", "Subtotal (₡)"].map(esc).join(",");
    const body   = rows.map(r => [
      esc(r.pieza), r.cantidad,
      esc(r.medidas.replace(/,/g, ".")),
      esc(r.material),
      r.precioUnit || 0,
      (r.precioUnit || 0) * r.cantidad,
    ].join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "plantilla_canva.csv"; a.click();
  };

  const downloadSVG = () => {
    const svg  = generateSVG(rows, structureType);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `molde_${structureType}.svg`; a.click();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif" }}>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e2433", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d1117" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✦</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>Creador Universal de Plantillas</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Diseño Digital & Proyectos Físicos · Costa Rica</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Modo:</span>
          <div style={{ display: "flex", background: "#1e2433", borderRadius: 10, padding: 4, gap: 4 }}>
            {[{ id: "canvas", label: "🎨 Papel/Canva" }, { id: "taller", label: "🔧 Taller/Real" }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{ padding: "6px 13px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s", background: mode === m.id ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "transparent", color: mode === m.id ? "#fff" : "#64748b" }}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "22px 18px" }}>

        {/* Size warning */}
        {sizeWarning && (
          <div style={{ background: "#2d1a0e", border: "1px solid #f59e0b", borderRadius: 10, padding: "10px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span>⚠️</span>
            <span style={{ fontSize: 13, color: "#fbbf24" }}>
              <strong>Alerta de tamaño:</strong> Piezas superan el formato {PAPER.label} ({PAPER.w}×{PAPER.h} cm). Usa el escalado o cambia a Modo Taller.
            </span>
          </div>
        )}

        {/* Paper size selector */}
        {mode === "canvas" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 10, padding: "10px 16px" }}>
            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>📄 Tamaño de hoja:</span>
            <div style={{ display: "flex", background: "#0f1117", borderRadius: 8, padding: 3, gap: 3 }}>
              {[{ id: "carta", label: "Carta  21.59 × 27.94 cm" }, { id: "a4", label: "A4  21.0 × 29.7 cm" }].map(s => (
                <button key={s.id} onClick={() => setPaperSize(s.id)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s", background: paperSize === s.id ? "#6366f1" : "transparent", color: paperSize === s.id ? "#fff" : "#64748b" }}>{s.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Input mode tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#1e2433", borderRadius: 12, padding: 5, width: "fit-content" }}>
          {[{ id: "auto", label: "⚡ Modo Automático (API)" }, { id: "manual", label: "🤖 Modo Asistido (Manual)" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s", background: tab === t.id ? "#6366f1" : "transparent", color: tab === t.id ? "#fff" : "#64748b" }}>{t.label}</button>
          ))}
        </div>

        {/* ── AUTO TAB ── */}
        {tab === "auto" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="🔗 Enlace de Referencia" subtitle="Pega un enlace de YouTube o Pinterest">
              <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://youtube.com/watch?v=..." style={inputStyle}/>
            </Card>
            <Card title="📝 Contexto Extra" subtitle="Notas adicionales o instrucciones del proyecto">
              <textarea value={context} onChange={e => setContext(e.target.value)} rows={3} placeholder="Ej: Estantería escandinava, 180cm de alto..." style={{ ...inputStyle, resize: "vertical" }}/>
              <button style={{ marginTop: 8, padding: "6px 14px", background: "#1e2433", border: "1px dashed #334155", borderRadius: 7, color: "#94a3b8", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Paperclip size={13} strokeWidth={2}/> Adjuntar archivo (simulado)
              </button>
            </Card>
            <Card title="📐 Ajustar al espacio disponible" subtitle="Opcional — reduce proporcionalmente el diseño a tu cuarto">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                {[["Ancho Máx. (cm)", maxW, setMaxW], ["Alto Máx. (cm)", maxH, setMaxH], ["Profundidad (cm)", maxD, setMaxD]].map(([lbl, v, s]) => (
                  <div key={lbl}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>{lbl}</div>
                    <input type="number" value={v} onChange={e => s(e.target.value)} placeholder="0" style={inputStyle}/>
                  </div>
                ))}
                <button onClick={applyScale} style={{ padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: scaled ? "#065f46" : "linear-gradient(135deg,#0ea5e9,#6366f1)", color: "#fff", whiteSpace: "nowrap" }}>
                  {scaled ? "✓ Aplicado" : "⟳ Escalar"}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>💡 Todas las piezas se reducen proporcionalmente para encajar en el espacio.</div>
            </Card>
            <button onClick={() => { setGenerating(true); setTimeout(() => { setGenerating(false); setGenerated(true); }, 1800); }} disabled={generating} style={{ padding: "13px 28px", borderRadius: 10, border: "none", cursor: generating ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 700, background: generating ? "#334155" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", boxShadow: generating ? "none" : "0 4px 24px rgba(99,102,241,0.4)", transition: "all 0.3s" }}>
              {generating ? "⏳ Analizando y generando..." : "✦ Generar Plantilla"}
            </button>
          </div>
        )}

        {/* ── MANUAL TAB ── */}
        {tab === "manual" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {STEPS.map((s, i) => (
                <div key={i} style={{ background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{s.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", letterSpacing: "1px" }}>PASO {s.num}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{s.desc}</div>
                </div>
              ))}
            </div>
            <Card title="📋 Prompt Base" subtitle="Copia y usa en NotebookLM">
              <div style={{ background: "#0d1117", border: "1px solid #1e2433", borderRadius: 8, padding: 12, fontSize: 12, color: "#94a3b8", fontFamily: "monospace", lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 130, overflow: "auto" }}>{PROMPT_BASE}</div>
              <button onClick={copyPrompt} style={{ marginTop: 8, padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: copied ? "#065f46" : "#1e2433", color: copied ? "#6ee7b7" : "#94a3b8", transition: "all 0.2s" }}>{copied ? "✓ ¡Copiado!" : "📋 Copiar Prompt"}</button>
            </Card>
            <Card title="🤖 Respuesta de la IA" subtitle="Pega aquí el JSON de NotebookLM">
              <textarea value={aiResponse} onChange={e => setAiResponse(e.target.value)} rows={5} placeholder={'[\n  {"pieza":"Panel Frontal","cantidad":1,"medidas":"60 x 90 cm","material":"MDF 15mm","precioUnit":3500}\n]'} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 13, resize: "vertical" }}/>
              <button onClick={() => { try { const p = JSON.parse(aiResponse); setRows(p); setGenerated(true); } catch { alert("JSON inválido."); } }} style={{ marginTop: 8, padding: "9px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>✦ Procesar Respuesta</button>
            </Card>
          </div>
        )}

        {/* ══ RESULTS ══ */}
        {generated && (
          <div style={{ marginTop: 26 }}>

            {/* Table toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>📊 Panel de Resultados</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Tabla editable en tiempo real</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={addRow}      style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: "#1e2433", color: "#94a3b8" }}>+ Fila</button>
                <button onClick={downloadCSV} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #6366f1", cursor: "pointer", fontSize: 12, fontWeight: 600, background: "transparent", color: "#818cf8" }}>📥 CSV para Canva</button>
                <button onClick={downloadSVG} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #8b5cf6", cursor: "pointer", fontSize: 12, fontWeight: 600, background: "transparent", color: "#a78bfa" }}>🖼️ SVG Molde</button>
                <button onClick={() => printFicha(rows, mode, structureType)} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #0ea5e9", cursor: "pointer", fontSize: 12, fontWeight: 600, background: "transparent", color: "#38bdf8" }}>🖨️ Ficha PDF</button>
              </div>
            </div>

            {/* Editable table */}
            <div style={{ background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#0f1117" }}>
                    {["Pieza", "Cant.", "Medidas", "Material", "Precio Unit. (₡)", "Subtotal", ""].map((h, i) => (
                      <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.8px", textTransform: "uppercase", borderBottom: "1px solid #1e2433" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e2433" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2433"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {["pieza", "cantidad", "medidas", "material", "precioUnit"].map(f => (
                        <td key={f} style={{ padding: "8px 12px" }}>
                          <input value={row[f] ?? ""} onChange={e => updateRow(i, f, e.target.value)} style={{ background: "transparent", border: "none", color: "#e2e8f0", fontSize: 13, width: "100%", outline: "none" }}/>
                        </td>
                      ))}
                      <td style={{ padding: "8px 12px", fontSize: 13, color: "#10b981", whiteSpace: "nowrap" }}>
                        {fmtColones((Number(row.precioUnit) || 0) * Number(row.cantidad))}
                      </td>
                      <td style={{ padding: "8px 8px" }}>
                        <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: "9px 16px", background: "#0d1117", display: "flex", gap: 14, fontSize: 12, color: "#475569", flexWrap: "wrap", alignItems: "center" }}>
                <span>📦 <strong style={{ color: "#94a3b8" }}>{rows.length}</strong> piezas</span>
                <span>🔢 <strong style={{ color: "#94a3b8" }}>{rows.reduce((s, r) => s + Number(r.cantidad), 0)}</strong> unidades</span>
                <span>📐 <strong style={{ color: mode === "canvas" ? "#818cf8" : "#34d399" }}>{mode === "canvas" ? "Papel/Canva" : "Taller/Real"}</strong></span>
                {sizeWarning && mode === "canvas" && <span style={{ color: "#f59e0b" }}>⚠️ Excede {PAPER.label}</span>}
                <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#10b981" }}>
                  Total estimado: {fmtColones(totalCosto)}
                </span>
              </div>
            </div>

            {/* Materials + cost summary */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>🛒 Lista de Compras de Materiales</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
                {materialSummary.map(({ mat, total, pieces, area, costo }) => (
                  <div key={mat} style={{ background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#c4b5fd" }}>{mat}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, background: "#6366f122", color: "#818cf8", border: "1px solid #6366f144", borderRadius: 20, padding: "2px 8px" }}>{pieces} uds.</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>📏 <strong style={{ color: "#e2e8f0" }}>{fmtNum(total)} cm</strong> — {fmtNum(total / 100)} m</div>
                    {area > 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>📐 Área: <strong style={{ color: "#e2e8f0" }}>{fmtNum(area / 10000)} m²</strong></div>}
                    {costo > 0 && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>💰 Costo: <strong style={{ color: "#10b981" }}>{fmtColones(costo)}</strong></div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Visualization tabs */}
            <div style={{ background: "#1a1f2e", border: "1px solid #1e2433", borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0d1117", borderRadius: 10, padding: 4, width: "fit-content" }}>
                {[{ id: "nesting", label: "✂️ Plano de Corte" }, { id: "assembly", label: "🧊 Ensamblaje 3D" }, { id: "svgprev", label: "🖼️ Vista SVG" }].map(t => (
                  <button key={t.id} onClick={() => setVisTab(t.id)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s", background: visTab === t.id ? "#6366f1" : "transparent", color: visTab === t.id ? "#fff" : "#64748b" }}>{t.label}</button>
                ))}
              </div>

              {visTab === "nesting" && <NestingViewer rows={rows} mode={mode} paperSize={paperSize}/>}

              {visTab === "assembly" && (
                <div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>TIPO DE ESTRUCTURA</div>
                    <select value={structureType} onChange={e => setStructureType(e.target.value)} style={{ background: "#0f1117", border: "1px solid #2d3748", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 13, outline: "none", cursor: "pointer", minWidth: 260 }}>
                      {STRUCTURE_TYPES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                    </select>
                  </div>
                  <AssemblyViewer structureType={structureType}/>
                </div>
              )}

              {visTab === "svgprev" && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>🖼️ Vista Previa del SVG</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>Representación del archivo descargable</div>
                  <div style={{ background: "#0d1117", borderRadius: 12, padding: 16, overflowX: "auto" }}>
                    <svg width="100%" viewBox="0 0 800 280" style={{ display: "block", maxHeight: 280 }}>
                      {(() => {
                        const pieces = [];
                        rows.forEach((r, ri) => {
                          const d = parseDims(r.medidas), w = d[0] || 40, h = d[1] || w;
                          for (let i = 0; i < Math.min(Number(r.cantidad), 6); i++)
                            pieces.push({ label: r.pieza, w, h, color: PALETTE[ri % PALETTE.length] });
                        });
                        const sc = Math.min(700 / Math.max(...pieces.map(p => p.w), 1), 2.5);
                        return nestRects(pieces, 800, 280, sc).map((p, i) => (
                          <g key={i}>
                            <rect x={p.x} y={p.y} width={p.pw} height={p.ph} fill={p.color} fillOpacity="0.2" stroke={p.color} strokeWidth="1.5" rx="3"/>
                            {p.pw > 20 && p.ph > 14 && (
                              <text x={p.x + p.pw / 2} y={p.y + p.ph / 2 + 4} textAnchor="middle" fill={p.color} fontSize="9" fontFamily="monospace">
                                {p.label.slice(0, 14)}
                              </text>
                            )}
                          </g>
                        ));
                      })()}
                    </svg>
                  </div>
                  <button onClick={downloadSVG} style={{ marginTop: 12, padding: "9px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>⬇️ Descargar SVG Real</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}