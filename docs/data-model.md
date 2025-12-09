# Datový model – Pluxeo

## Kolekce `cards`
- customerId: string (povinné) – interní ID zákazníka
- walletToken: string (povinné, unikátní) – token / identifikátor karty ve walletu
- notes: string (nepovinné) – poznámka
- createdAt: date (auto)
- updatedAt: date (auto)

## Kolekce `customers`
- email: string (unikátní)
- name: string
- createdAt, updatedAt

...
