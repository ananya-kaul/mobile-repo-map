import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/features/cart/application/cart_controller.dart';
import 'package:flutter_shop/router/app_routes.dart';
import '../application/catalog_providers.dart';
import 'image_viewer_screen.dart';

class ProductDetailScreen extends ConsumerWidget {
  const ProductDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productProvider(productId));
    return Scaffold(
      appBar: AppBar(title: const Text('Product')),
      body: product.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (p) => ListView(
          children: [
            GestureDetector(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ImageViewerScreen(urls: p.imageUrls, heroTag: 'product-${p.id}'),
                ),
              ),
              child: Hero(
                tag: 'product-${p.id}',
                child: AspectRatio(
                  aspectRatio: 1,
                  child: p.thumbnail.isEmpty
                      ? const ColoredBox(color: Colors.black12)
                      : Image.network(p.thumbnail, fit: BoxFit.cover),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(p.title, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text(Formatters.price(p.price), style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text(p.description),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.star_rate_rounded),
                    title: Text(Formatters.rating(p.rating)),
                    subtitle: Text('${p.reviewCount} reviews'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/product/${p.id}/reviews'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton.icon(
            icon: const Icon(Icons.add_shopping_cart),
            label: const Text('Add to cart'),
            onPressed: product.valueOrNull == null
                ? null
                : () {
                    ref.read(cartControllerProvider.notifier).add(product.requireValue);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text('Added to cart'),
                        action: SnackBarAction(
                          label: 'View',
                          onPressed: () => context.push(AppRoute.cart.path),
                        ),
                      ),
                    );
                  },
          ),
        ),
      ),
    );
  }
}
