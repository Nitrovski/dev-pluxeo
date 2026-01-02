# Cleanup legacy Google Wallet passType

Use this one-time Mongo update to replace legacy `wallet.google.passType="loyalty"` entries in `cardtemplates`.

```js
// Mongo shell / mongosh
use <your-db-name>;

db.cardtemplates.updateMany(
  { "wallet.google.passType": "loyalty" },
  { $set: { "wallet.google.passType": "generic" } }
);
```

If you prefer to remove the field entirely, replace `$set` with `$unset`:

```js
db.cardtemplates.updateMany(
  { "wallet.google.passType": "loyalty" },
  { $unset: { "wallet.google.passType": "" } }
);
```
