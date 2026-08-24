export type LocalConversation = {
  id: string;
  title: string;
  createdAt: string;
};

export type LocalProject = {
  id: string;
  name: string;
  path: string;
  conversations: LocalConversation[];
};

export type StoredProjects = { projects: LocalProject[] };
