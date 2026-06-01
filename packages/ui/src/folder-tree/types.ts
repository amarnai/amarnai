export type FolderItem = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  ignored: boolean;
};
