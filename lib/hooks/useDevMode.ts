"use client";

import { useEffect, useState } from "react";
import { isDevUser, resolveUserEmail } from "@/lib/devMode";

export function useDevMode() {
  const [isDev, setIsDev] = useState(false);
  const [devEmail, setDevEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function check() {
      const [dev, email] = await Promise.all([isDevUser(), resolveUserEmail()]);
      if (isMounted) {
        setIsDev(dev);
        setDevEmail(email);
        setLoading(false);
      }
    }
    check();
    return () => { isMounted = false; };
  }, []);

  return { isDev, devEmail, loading };
}
