import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/features/cart/application/cart_controller.dart';
import 'package:flutter_shop/router/app_routes.dart';
import '../application/catalog_providers.dart';
import 'widgets/filter_sheet.dart';
import 'widgets/product_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(productsProvider);
    final cartCount = ref.watch(cartControllerProvider.select((c) => c.totalQuantity));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Flutter Shop'),
        actions: [
          IconButton(
            tooltip: 'Filter',
            icon: const Icon(Icons.tune),
            onPressed: () => showModalBottomSheet(
              context: context,
              showDragHandle: true,
              builder: (_) => const FilterSheet(),
            ),
          ),
          IconButton(
            tooltip: 'Account',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push(AppRoute.profile.path),
          ),
          Badge(
            isLabelVisible: cartCount > 0,
            label: Text('$cartCount'),
            child: IconButton(
              tooltip: Formatters.quantity(cartCount),
              icon: const Icon(Icons.shopping_cart_outlined),
              onPressed: () => context.push(AppRoute.cart.path),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(productsProvider.future),
        child: products.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Could not load products\n$e', textAlign: TextAlign.center)),
          data: (items) {
            if (items.isEmpty) {
              return const Center(child: Text('Nothing matches your filters'));
            }
            return GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                childAspectRatio: 0.62,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
              ),
              itemCount: items.length,
              itemBuilder: (context, i) => ProductCard(
                product: items[i],
                onAddToCart: () => ref.read(cartControllerProvider.notifier).add(items[i]),
              ),
            );
          },
        ),
      ),
    );
  }
}
