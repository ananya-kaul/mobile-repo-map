import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import '../../data/product.dart';

/// Grid tile used on the home feed and in "related products".
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, this.onAddToCart});

  final Product product;
  final VoidCallback? onAddToCart;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/product/${product.id}'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: product.thumbnail.isEmpty
                  ? const ColoredBox(color: Colors.black12)
                  : Image.network(product.thumbnail, fit: BoxFit.cover),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(Formatters.price(product.price), style: theme.textTheme.titleMedium),
                  if (!product.inStock)
                    Text('Out of stock', style: TextStyle(color: theme.colorScheme.error)),
                ],
              ),
            ),
            if (onAddToCart != null && product.inStock)
              TextButton.icon(
                key: const Key('product-card-add'),
                onPressed: onAddToCart,
                icon: const Icon(Icons.add_shopping_cart),
                label: const Text('Add'),
              ),
          ],
        ),
      ),
    );
  }
}
