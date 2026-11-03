/** Données structurées schema.org, à placer dans un <script type="application/ld+json"> (« < » échappé). */
export const jsonLd = (data: object) => ({ __html: JSON.stringify(data).replace(/</g, "\\u003c") });
