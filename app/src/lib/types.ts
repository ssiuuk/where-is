export type Place = {
  id: string;
  household: string;
  name: string;
  note: string;
  parent: string; // "" for a top-level place
  updated: string;
};

export type Item = {
  id: string;
  household: string;
  name: string;
  note: string;
  photo: string; // file name, "" when there is none
  place: string; // "" when nobody knows yet
  moved_by: string;
  moved_at: string;
  updated: string;
  collectionId: string;
};

export type Member = {
  id: string;
  name: string;
  email?: string;
  avatar: string;
  collectionId: string;
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  owner: string;
};

export type Move = {
  id: string;
  item: string;
  from_place: string;
  to_place: string;
  by: string;
  created: string;
};
