const key = new URLSearchParams(location.hash.slice(1)).get("access");

if (key) {
  const status = document.querySelector("#owner-status");
  history.replaceState(null, "", location.pathname + location.search);
  status.textContent = "Opening your dashboard…";
  try {
    const response = await fetch("/api/owner/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (response.ok) {
      location.reload();
    } else {
      const result = await response.json();
      status.textContent = result.error || "Couldn’t open the dashboard. Reopen your private link to try again.";
    }
  } catch {
    status.textContent = "Couldn’t connect. Reopen your private link to try again.";
  }
}
