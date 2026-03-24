function showBootError(err, detail) {
  const main = document.getElementById("main");
  if (!main) return;

  const loc =
    err && typeof err === "object"
      ? `${err.fileName ? String(err.fileName) : ""}${err.lineNumber ? `:${err.lineNumber}` : ""}${err.columnNumber ? `:${err.columnNumber}` : ""}`.trim()
      : "";

  const container = document.createElement("div");
  container.className = "container";

  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Blad uruchomienia";
  card.appendChild(title);

  const message = document.createElement("div");
  message.className = "sub";
  message.textContent = String(err?.message ?? err);
  card.appendChild(message);

  if (loc) {
    const locEl = document.createElement("div");
    locEl.className = "sub";
    locEl.style.cssText = "opacity:0.85;margin-top:6px";
    locEl.textContent = loc;
    card.appendChild(locEl);
  }

  if (detail) {
    const detailEl = document.createElement("pre");
    detailEl.className = "sub";
    detailEl.style.cssText = "white-space:pre-wrap;opacity:0.85;margin-top:10px";
    detailEl.textContent = detail;
    card.appendChild(detailEl);
  }

  container.appendChild(card);
  main.innerHTML = "";
  main.appendChild(container);
}

async function start() {
  try {
    await import("./app.js");
  } catch (err) {
    console.error(err);
    const modules = [
      "./ui.js",
      "./db.js",
      "./logic.js",
      "./pages/attendance.js",
      "./pages/payments.js",
      "./pages/people.js",
      "./pages/groups.js",
      "./pages/stats.js",
      "./pages/settings.js",
      "./app.js"
    ];

    let detail = "";
    for (const modulePath of modules) {
      try {
        await import(modulePath);
      } catch (moduleErr) {
        detail = `${modulePath}: ${String(moduleErr?.message ?? moduleErr)}\n${String(moduleErr?.stack ?? "")}`;
        break;
      }
    }

    showBootError(err, detail);
  }
}

start();
