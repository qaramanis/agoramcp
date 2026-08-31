"use client";

import { useEffect, useState } from "react";

export default function Template({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className="transition-opacity duration-300 ease-out"
      style={{
        opacity: visible ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}
