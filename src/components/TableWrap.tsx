/**
 * Conteneur d'un tableau de données : il défile s'il reste trop large (au clavier aussi) et, sur téléphone, chaque
 * ligne devient une fiche où chaque cellule reprend l'intitulé de sa colonne (attribut data-label, globals.css).
 */
export function TableWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
