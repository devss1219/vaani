import "./globals.css";

export const metadata = {
    title: "Vaani Voice Agent",
    description: "Multi-tenant voice AI platform — Multilingual Voice AI for Sales, Support, and Collections.",
    themeColor: "#ebf0f5",
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" className="antialiased">
            <body className="min-h-[100dvh]">{children}</body>
        </html>
    );
}