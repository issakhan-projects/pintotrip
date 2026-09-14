import type { Metadata } from "next";
import { Lobster, Montserrat, Manrope } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const lobster = Lobster({
  variable: "--font-lobster",
  subsets: ["latin"],
  weight: "400",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PinToTrip",
  description: "See it. Find it. Save it. — Personal travel discovery map.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "1024x1024" },
    ],
    apple: [{ url: "/icon.png", type: "image/png" }],
    shortcut: ["/icon.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${lobster.variable} h-full antialiased`}
    >
      <body className={`${montserrat.className} flex h-full min-h-full flex-col`}>
        {children}
      </body>
    </html>
  );
}
