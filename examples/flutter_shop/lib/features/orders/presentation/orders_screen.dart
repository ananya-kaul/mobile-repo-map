import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/router/app_routes.dart';
import '../data/orders_repository.dart';

/// Body only; the route wraps it in AppScaffold.
class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(ordersProvider);
    return orders.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Could not load orders: $e')),
      data: (items) {
        if (items.isEmpty) {
          return Center(
            child: TextButton(
              onPressed: () => context.go(AppRoute.home.path),
              child: const Text('No orders yet — start shopping'),
            ),
          );
        }
        return ListView.builder(
          itemCount: items.length,
          itemBuilder: (context, i) {
            final order = items[i];
            return ListTile(
              title: Text(Formatters.orderNumber(order.id)),
              subtitle: Text(
                '${Formatters.shortDate(order.placedAt)} · ${Formatters.quantity(order.itemCount)}',
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(Formatters.price(order.total)),
                  _StatusChip(order.status),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.status);

  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      OrderStatus.delivered => Colors.green,
      OrderStatus.cancelled => Colors.red,
      OrderStatus.shipped => Colors.blue,
      _ => Colors.grey,
    };
    return Text(status.name, style: TextStyle(color: color, fontSize: 12));
  }
}
