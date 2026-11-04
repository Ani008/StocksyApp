import React, { useEffect, useState } from "react";

import ProfileSetupModal from "./ProfileSetupModal";
import { getMyProfile } from "../../services/profileService";
import { getSetupNeeds } from "../utils/profileSetup";

// People who pressed the cross, by user id. Lives for this app launch only, so
// a dismissed box comes back on the next launch (until they finish it) but not
// every time the home screen is shown. Keyed by user so someone else signing in
// on the same device in the same launch still gets asked.
const dismissedFor = new Set();

/**
 * ProfileSetupGate — mounted once inside the signed-in app (App.js MainTabs).
 *
 * Asks the server for the person's profile and shows the Username | Avatar box
 * only if one of them has not been chosen yet. Because it asks the server
 * rather than trusting what login returned, it behaves the same after email
 * login, Google login/signup, and when the app reopens already signed in. If
 * the request fails it shows nothing: this box must never get in the way.
 */
export default function ProfileSetupGate() {
  const [profile, setProfile] = useState(null); // { id, username, avatarId }
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMyProfile();
        if (cancelled) return;
        const loaded = { id: me.id, username: me.username ?? null, avatarId: me.avatarId ?? null };
        setProfile(loaded);
        if (getSetupNeeds(loaded).needsAny && !dismissedFor.has(loaded.id)) setVisible(true);
      } catch {
        /* offline or signed out: no box */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    if (profile) dismissedFor.add(profile.id);
    setVisible(false);
  };

  const handleSaved = (next) => {
    const merged = { ...profile, ...next };
    setProfile(merged);
    if (!getSetupNeeds(merged).needsAny) setVisible(false); // all done
  };

  if (!profile) return null;
  return (
    <ProfileSetupModal
      visible={visible}
      profile={profile}
      onSaved={handleSaved}
      onClose={handleClose}
    />
  );
}
