

  socket.on("presence:update", async ({ userId, online }) => {
    const id = String(userId);
    const idx = contacts.findIndex((c) => String(c.id) === id);

    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], online };
    } else {
      await refreshContacts();
    }

    if (activePeer && String(activePeer.id) === id) {
      const fresh = contacts.find((c) => String(c.id) === id);
      if (fresh) activePeer = fresh;
      setActiveHeader();
    }

    renderContacts(contactSearch.value.trim());
  });


async function boot() {
  const meRes = await fetch("/api/me", { credentials: "include" });
  if (!meRes.ok) {
    window.location.href = "/login.html";
    return;
  }
  const meData = await meRes.json();
  me = {
    id: meData.user.id,
    name: meData.user.displayName,
    email: meData.user.email,  
  };

  renderSelfProfile();

  const cRes = await fetch("/api/contacts", { credentials: "include" });
  if (!cRes.ok) return;
  const cData = await cRes.json();
  contacts = cData.contacts || [];

  renderContacts();
  const first = contacts[0];
  if (first) await selectPeer(first);
  else {
    showMainEmpty();
  }

  connectSocket();
}

boot();