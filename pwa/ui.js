export const DAYS = [
  { id: 1, label: "Poniedziałek" },
  { id: 2, label: "Wtorek" },
  { id: 3, label: "Środa" },
  { id: 4, label: "Czwartek" },
  { id: 5, label: "Piątek" },
  { id: 6, label: "Sobota" },
  { id: 7, label: "Niedziela" }
];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style") node.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, `${v}`);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function fmtMoney(value, currency = "PLN") {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `0 ${currency}`;
  return `${n.toFixed(0)} ${currency}`;
}

export function fmtSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return "Brak harmonogramu";
  const parts = schedule
    .slice()
    .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.startTime ?? "").localeCompare(b.startTime ?? ""))
    .map((e) => {
      const d = DAYS.find((x) => x.id === e.dayOfWeek)?.label ?? "?";
      const t = e.startTime ?? "--:--";
      return `${d} ${t}`;
    });
  return parts.join(" · ");
}

export function iconToggle(on) {
  return el("div", { class: `toggle ${on ? "on" : ""}`, "aria-hidden": "true" });
}

export function bigListItem({ title, subtitle, right, onClick }) {
  return el(
    "div",
    {
      class: "item big",
      role: "button",
      tabindex: "0",
      onclick: onClick,
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.();
      }
    },
    [
      el("div", { class: "stack" }, [
        el("div", { class: "title", text: title }),
        subtitle ? el("div", { class: "sub", text: subtitle }) : null
      ]),
      right ?? el("div", { class: "sub muted", text: "›" })
    ]
  );
}

export function showToast(text) {
  const toast = el(
    "div",
    {
      class: "card",
      style:
        "position:fixed;left:12px;right:12px;bottom:12px;max-width:760px;margin:0 auto;z-index:10;background:rgba(14,22,40,0.98)"
    },
    [
      el("div", { class: "row space" }, [
        el("div", { class: "sub", text }),
        el("button", { class: "btn btn--ghost", text: "OK", onclick: () => toast.remove() })
      ])
    ]
  );
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1800);
}

export function showModalError(text) {
  const body = document.getElementById("modalBody");
  if (!body) {
    showToast(text);
    return;
  }
  let node = body.querySelector('[data-modal-error="1"]');
  if (!node) {
    node = el("div", { class: "pill danger", dataset: { modalError: "1" } }, [el("span", { text })]);
    body.prepend(node);
  } else {
    node.textContent = text;
  }
  node.scrollIntoView({ block: "nearest" });
}

export function setTitle(text) {
  const t = (text ?? "").trim();
  if (t) document.title = `${t} — Klub`;
  const elTitle = document.getElementById("appTitle");
  if (elTitle) elTitle.textContent = t || "Klub";
}

export function setActions(nodes) {
  const root = document.getElementById("topbarActions");
  root.innerHTML = "";
  for (const n of nodes ?? []) root.appendChild(n);
}

export function setActiveTab(route) {
  const tabs = [
    ["attendance", "tab-attendance"],
    ["payments", "tab-payments"],
    ["groups", "tab-groups"],
    ["stats", "tab-stats"],
    ["people", "tab-people"],
  ];
  for (const [key, id] of tabs) {
    const a = document.getElementById(id);
    a.classList.toggle("active", route.includes(key));
  }
}

export function btn(label, onClick, extraClass = "") {
  return el("button", { type: "button", class: `btn ${extraClass}`.trim(), text: label, onclick: onClick });
}

export function openModal({ title, body, footer }) {
  const modal = document.getElementById("modal");
  document.getElementById("modalTitle").textContent = title ?? "Okno";
  const b = document.getElementById("modalBody");
  const f = document.getElementById("modalFooter");
  b.innerHTML = "";
  f.innerHTML = "";
  if (body) b.appendChild(body);
  if (footer) footer.forEach((n) => f.appendChild(n));
  modal.showModal();
  return modal;
}

export function closeModal() {
  const modal = document.getElementById("modal");
  if (modal.open) modal.close();
}
