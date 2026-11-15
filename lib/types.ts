export type Campaign = {
  id: string;
  title: string;
  story: string;
  goal: number;
  raised: number;
  starts_at: string;
  ends_at: string;
  open: boolean;
  category_id: string;
  category: string;
  image_key: string | null;
};
export type ListValue = { id: string; name: string };
export type Receipt = { year: number; number: number };
export type CampaignDetails = {
  campaign: Campaign;
  amounts: { id: string; amount: number }[];
  updates: { id: string; body: string; created_at: string }[];
  gifts: { id: string; name: string; amount: number }[];
};
export type Giving = {
  requests: { id: string; amount: number; monthly: boolean; status: string; title: string }[];
  gifts: ({ id: string; request_id: string; amount: number; title: string } & Receipt)[];
};
export type Desk = {
  categories: ListValue[];
  donors: { id: string; name: string; email: string }[];
  gifts: { id: string; name: string; amount: number; anonymous: boolean; status: string }[];
};
export type Settings = { categories: ListValue[]; statuses: ListValue[] };
