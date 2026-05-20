import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

def func(x, y):
    return (x-1)**2 + 1

fig = plt.figure()
ax = fig.add_subplot(111, projection='3d')

x = np.linspace(-5, 7, 1000)
y = np.linspace(-5, 7, 1000)
X, Y = np.meshgrid(x, y)
Z = func(X, Y)

ax.plot_surface(X, Y, Z, cmap='plasma')
ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_zlabel('z')
ax.set_title('y=(x-1)^2+1 Function Plot')

plt.show()