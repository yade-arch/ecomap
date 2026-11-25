import { Redirect } from 'expo-router';

// The map is the home screen.
export default function Index() {
  return <Redirect href="/map" />;
}
