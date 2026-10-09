import { useId, useState } from "react";
import "./CollectionEditor.css";
export interface CollectionChoice { id: string; label: string; detail: string }
export interface EditableCollection { id: string; label: string; choiceIds: readonly string[]; version?: number | undefined }
/** Generic named selections. Changes stay local until Save; deletion needs a second press. */
export function CollectionEditor({ collections, choices, pending, error, emptyText, onSave, onRemove }: {
  emptyText: string;
  collections: readonly EditableCollection[]; choices: readonly CollectionChoice[]; pending: boolean; error?: string | undefined;
  onSave: (id: string | undefined, name: string, selected: string[], version?: number) => Promise<void>;
  onRemove: (id: string, version?: number) => Promise<void>;
}) {
  const field = useId();
  const [edit, setEdit] = useState<{ id?: string; name: string; selected: string[]; version?: number | undefined }>();
  const [deleting, setDeleting] = useState<{ id: string; version?: number | undefined }>();
  return <section className="collection-editor" aria-label="Named collections" aria-busy={pending}>
    {!edit && <div className="collection-editor-actions"><button className="collection-editor-button" type="button" disabled={pending} onClick={() => { setEdit({ name: "", selected: [] }); setDeleting(undefined); }}>New group</button></div>}
    {error && <p className="collection-editor-error" role="alert">{error}</p>}
    {collections.length === 0 && !edit && <p className="collection-editor-hint">{emptyText}</p>}
    {!edit && collections.map((item) => <div className="collection-editor-row" key={item.id}>
      <strong className="collection-editor-name">{item.label}</strong><span className="collection-editor-hint">{item.choiceIds.length} {item.choiceIds.length === 1 ? "member" : "members"}</span>
      <button className="collection-editor-button" type="button" disabled={pending} onClick={() => { setEdit({ id: item.id, name: item.label, selected: [...item.choiceIds], version: item.version }); setDeleting(undefined); }}>Edit {item.label}</button>
      <button className="collection-editor-button" type="button" disabled={pending} onClick={() => { if (deleting?.id === item.id) void onRemove(item.id, deleting.version).then(() => setDeleting(undefined)).catch(() => undefined); else setDeleting({ id: item.id, version: item.version }); }}>{deleting?.id === item.id ? `Confirm delete ${item.label}` : `Delete ${item.label}`}</button>
    </div>)}
    {edit && <form className="collection-editor-form" onSubmit={(event) => {
      event.preventDefault();
      void onSave(edit.id, edit.name, edit.selected, edit.version).then(() => setEdit(undefined)).catch(() => undefined);
    }}>
      <div className="collection-editor-actions" data-sticky><button className="collection-editor-button" type="submit" disabled={pending || !edit.name.trim()}>Save group</button><button className="collection-editor-button" type="button" disabled={pending} onClick={() => setEdit(undefined)}>Cancel</button></div>
      <label className="collection-editor-label" htmlFor={field}>Group name</label>
      <input className="collection-editor-input" id={field} value={edit.name} maxLength={100} required disabled={pending} onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
      <fieldset className="collection-editor-choices" disabled={pending}><legend>Members</legend>
        {choices.map((choice) => <label className="collection-editor-choice" key={choice.id}>
          <input type="checkbox" checked={edit.selected.includes(choice.id)} onChange={(event) => setEdit({ ...edit, selected: event.target.checked ? [...edit.selected, choice.id] : edit.selected.filter((id) => id !== choice.id) })} />
          <span className="collection-editor-copy"><strong>{choice.label}</strong><small className="collection-editor-path">{choice.detail}</small></span>
        </label>)}
        {edit.selected.filter((id) => !choices.some((choice) => choice.id === id)).map((id) => <label className="collection-editor-choice" key={id}>
          <input type="checkbox" checked onChange={() => setEdit({ ...edit, selected: edit.selected.filter((key) => key !== id) })} />Unavailable member: {id}
        </label>)}
      </fieldset>
    </form>}
  </section>;
}
