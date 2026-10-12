import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_shop/features/catalog/data/product.dart';
import 'package:flutter_shop/features/catalog/presentation/widgets/product_card.dart';

void main() {
  const product = Product(
    id: 'p1',
    title: 'Canvas Tote',
    price: 1249.0,
    imageUrls: [],
    inStock: true,
  );

  Widget host(Widget child) => MaterialApp(home: Scaffold(body: SizedBox(width: 200, child: child)));

  testWidgets('shows title and formatted price', (tester) async {
    await tester.pumpWidget(host(const ProductCard(product: product)));

    expect(find.text('Canvas Tote'), findsOneWidget);
    expect(find.text(r'$1,249.00'), findsOneWidget);
  });

  testWidgets('add button calls back', (tester) async {
    var added = 0;
    await tester.pumpWidget(host(ProductCard(product: product, onAddToCart: () => added++)));

    await tester.tap(find.byKey(const Key('product-card-add')));

    expect(added, 1);
  });
}
