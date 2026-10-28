import type { ImageSourcePropType } from 'react-native';

// THE list of avatars a passenger can choose: id -> image, in the order the picker shows them.
// The id is what profiles.avatar_id stores, so an id must never be reused for another image. To
// add one, add a line here (the server accepts ids 1-99). Images: 512x512 JPEG, cropped to the
// bubble from the originals in design/avatars-source/ (not bundled).
export const AVATARS: ReadonlyArray<{ id: number; source: ImageSourcePropType }> = [
  { id: 1, source: require('../../assets/avatars/avatar-1.jpg') },
  { id: 2, source: require('../../assets/avatars/avatar-2.jpg') },
  { id: 3, source: require('../../assets/avatars/avatar-3.jpg') },
  { id: 4, source: require('../../assets/avatars/avatar-4.jpg') },
  { id: 5, source: require('../../assets/avatars/avatar-5.jpg') },
  { id: 6, source: require('../../assets/avatars/avatar-6.jpg') },
  { id: 7, source: require('../../assets/avatars/avatar-7.jpg') },
  { id: 8, source: require('../../assets/avatars/avatar-8.jpg') },
];

export const AVATAR_IDS = AVATARS.map((avatar) => avatar.id);
