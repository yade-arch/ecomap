// Issue categories (EARTHCARE). Group -> sub-types. Routing to departments is a suggestion
// the municipality can change (departments.issue_groups).
export type IssueGroup = 'environment' | 'park_nature' | 'infrastructure' | 'disaster';

export const ISSUE_GROUPS: { group: IssueGroup; icon: 'leaf' | 'flower' | 'construct' | 'thunderstorm'; types: string[] }[] = [
  { group: 'environment', icon: 'leaf', types: ['garbage', 'debris', 'coastal', 'stream', 'hazardous_waste'] },
  { group: 'park_nature', icon: 'flower', types: ['fallen_tree', 'park_damage', 'green_area', 'habitat'] },
  { group: 'infrastructure', icon: 'construct', types: ['sidewalk', 'road', 'lighting', 'container', 'furniture'] },
  { group: 'disaster', icon: 'thunderstorm', types: ['flood', 'landslide', 'blocked_road', 'storm'] },
];

export type MuniStatus =
  | 'submitted'
  | 'accepted'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'verified'
  | 'rejected'
  | 'duplicate'
  | 'reopened';

export const OPEN_MUNI: MuniStatus[] = ['submitted', 'accepted', 'assigned', 'in_progress', 'resolved', 'reopened'];
