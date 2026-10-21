import "./globals.css";

export const metadata = {
    title: "Vaani Voice Agent",
    description: "Multi-tenant voice AI platform",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}