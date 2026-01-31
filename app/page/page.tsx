import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../components/ui/Card";

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Card</CardTitle>
        <CardDescription>
          Si tu vois une carte avec bordure + padding, c’est OK.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>Contenu de la carte.</p>
      </CardContent>
    </Card>
  );
}