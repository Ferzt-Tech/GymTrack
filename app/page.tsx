"use client";

import { useEffect } from "react";
import { resolveUserId } from "@/lib/auth-utils";

export default function Root() {
  useEffect(() => {
    async function redirect() {
      const userId = await resolveUserId();
      if (userId) {
        window.location.replace("/home/");
      } else {
        window.location.replace("/login/");
      }
    }
    redirect();
  }, []);
  return null;
}
