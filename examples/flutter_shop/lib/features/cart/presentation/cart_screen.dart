import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/router/app_routes.dart';
import '../application/cart_controller.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(cartControllerProvider);
    final controller = ref.read(cartControllerProvider.notifier);

    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Cart')),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Your cart is empty'),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => context.go(AppRoute.home.path),
                child: const Text('Continue shopping'),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text('Cart · ${Formatters.quantity(cart.totalQuantity)}')),
      body: ListView.separated(
        itemCount: cart.items.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, i) {
          final item = cart.items[i];
          return Dismissible(
            key: ValueKey(item.id),
            direction: DismissDirection.endToStart,
            onDismissed: (_) => controller.remove(item),
            background: Container(color: Colors.red.shade100),
            child: ListTile(
              title: Text(item.title),
              subtitle: Text(Formatters.price(item.unitPrice)),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.remove),
                    onPressed: () => controller.setQuantity(item, item.quantity - 1),
                  ),
                  Text('${item.quantity}'),
                  IconButton(
                    icon: const Icon(Icons.add),
                    onPressed: () => controller.setQuantity(item, item.quantity + 1),
                  ),
                ],
              ),
            ),
          );
        },
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: cart.syncing ? null : () => context.pushNamed('checkout'),
            child: Text('Checkout · ${Formatters.price(cart.subtotal)}'),
          ),
        ),
      ),
    );
  }
}
